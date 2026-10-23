import { describe, expect, it } from 'vite-plus/test'
import { checkDeployWorkflow } from '../guards/deploy-workflow.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

const PATH = '.github/workflows/deploy.yml'

const GOOD = {
  on: [
    'on:',
    '  push:',
    '    branches: [main, release]',
    '  workflow_dispatch:',
    '    inputs:',
    '      target:',
    '        description: staging or production',
    '        required: true',
    '        type: choice',
    '        options: [staging, production]',
  ],
  gate: "    if: github.repository == 'hollware/hollware' && vars.DEPLOY_ENABLED == 'true'",
  environment: '    environment: deploy',
  env: [
    '          EVENT_NAME: ${{ github.event_name }}',
    '          REF: ${{ github.ref }}',
    '          ASKED: ${{ inputs.target }}',
  ],
  run: [
    '          if [ "$EVENT_NAME" = "workflow_dispatch" ]; then target="$ASKED"',
    '          elif [ "$REF" = "refs/heads/release" ]; then target=production',
    '          else target=staging',
    '          fi',
    '          node scripts/deploy.ts --target "$target"',
  ],
}

const workflow = (parts: Partial<typeof GOOD> = {}) => {
  const { on, gate, environment, env, run } = { ...GOOD, ...parts }
  return file(
    PATH,
    [
      ...on,
      'jobs:',
      '  deploy:',
      gate,
      environment,
      '    steps:',
      '      - name: Deploy and probe',
      '        env:',
      ...env,
      '        run: |',
      ...run,
      '',
    ].join('\n'),
  )
}

describe('deploy workflow', () => {
  it('deploys staging from main, production from release, either by hand, gated to the environment deploy', () => {
    expect(describeViolations(checkDeployWorkflow(file(PATH, readText(PATH))))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the shape of the workflow', () => {
      expect(checkDeployWorkflow(workflow())).toEqual([])
    })

    it('reports another trigger, another branch and a target input that is free text', () => {
      const on = [
        'on:',
        '  pull_request:',
        '  push:',
        '    branches: [main]',
        '  workflow_dispatch:',
        '    inputs:',
        '      target:',
        '        type: string',
      ]
      expect(checkDeployWorkflow(workflow({ on }))).toEqual([
        {
          rule: 'deploy-workflow/triggers',
          file: PATH,
          message:
            '"on" must be exactly ["push","workflow_dispatch"]: a deploy runs on a push or by hand, found ["pull_request","push","workflow_dispatch"]',
        },
        {
          rule: 'deploy-workflow/triggers',
          file: PATH,
          message:
            '"on.push.branches" must be ["main","release"]: main deploys staging and release production, found ["main"]',
        },
        {
          rule: 'deploy-workflow/triggers',
          file: PATH,
          message:
            '"on.workflow_dispatch.inputs.target" must be {"description":"staging or production","required":true,"type":"choice","options":["staging","production"]}, found {"type":"string"}',
        },
      ])
    })

    it('reports a job without the DEPLOY_ENABLED gate or the environment deploy', () => {
      expect(
        checkDeployWorkflow(
          workflow({
            gate: "    if: github.repository == 'hollware/hollware'",
            environment: '    environment: production',
          }),
        ),
      ).toEqual([
        {
          rule: 'deploy-workflow/gate',
          file: PATH,
          message:
            'job "deploy" must run only if vars.DEPLOY_ENABLED == \'true\': a fork never deploys, and nothing deploys until the environment deploy holds its token',
        },
        {
          rule: 'deploy-workflow/environment',
          file: PATH,
          message:
            'job "deploy" must have "environment: deploy", the only place that holds the Cloudflare token, found "production"',
        },
      ])
      expect(
        checkDeployWorkflow(workflow({ gate: "    if: vars.DEPLOY_ENABLED == 'true'" })).map(
          (violation) => violation.message,
        ),
      ).toEqual([
        'job "deploy" must run only if github.repository == \'hollware/hollware\': a fork never deploys, and nothing deploys until the environment deploy holds its token',
      ])
    })

    it('reports a deploy step that picks its target another way, or no deploy step', () => {
      const staging = '          elif [ "$REF" = "refs/heads/release" ]; then target=staging'
      const [first = '', , ...rest] = GOOD.run
      expect(checkDeployWorkflow(workflow({ run: [first, staging, ...rest] }))).toEqual([
        {
          rule: 'deploy-workflow/target',
          file: PATH,
          message:
            'the deploy step must take the target of a manual run, production on release and staging otherwise, from {"EVENT_NAME":"${{ github.event_name }}","REF":"${{ github.ref }}","ASKED":"${{ inputs.target }}"}; missing lines ["elif [ \\"$REF\\" = \\"refs/heads/release\\" ]; then target=production"]',
        },
      ])
      expect(
        checkDeployWorkflow(workflow({ env: GOOD.env.slice(0, 2) })).map((v) => v.rule),
      ).toEqual(['deploy-workflow/target'])
      expect(checkDeployWorkflow(workflow({ run: ['          echo deploy'] }))).toEqual([
        {
          rule: 'deploy-workflow/target',
          file: PATH,
          message: 'one step must run `node scripts/deploy.ts --target "$target"`, found 0',
        },
      ])
    })
  })
})

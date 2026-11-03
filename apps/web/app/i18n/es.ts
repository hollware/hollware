import type { Messages } from './en'

export const es: Messages = {
  language: { name: 'Español', switch: 'Read in English', switchTo: 'English' },
  seo: {
    home: 'Hollware: el CMS en el que escriben tus agentes',
    description:
      'Hollware es un CMS headless de código abierto en Cloudflare Workers. Los agentes escriben Markdown por MCP, los contratos revisan cada escritura y tus sitios lo leen por Workers RPC.',
  },
  nav: {
    docs: 'Documentación',
    features: 'Funciones',
    compare: 'Comparar',
    tools: 'Herramientas',
    demo: 'Demo',
    github: 'Hollware en GitHub',
  },
  footer: { license: 'Código abierto, MIT', by: 'Hecho por', author: 'Sergio Azócar' },
  pages: {
    notFound: 'Página no encontrada',
    unavailable: 'Hollware no responde en este momento: intenta de nuevo en un minuto',
    untranslated: 'Esta página todavía no está traducida al español: la ves en inglés.',
    markdown: 'Markdown',
    features: 'Funciones',
    compare: 'Comparar',
    glossary: 'Glosario',
    home: 'Inicio',
    reviewed: (date: string) => `Fuentes leídas el ${date}`,
    sources: 'Fuentes',
    empty: 'Todavía no hay nada aquí',
    install: {
      button: 'Instálalo con tu agente',
      copied: 'Copiado: pégalo en tu agente',
      agents: 'Agentes',
      claude: 'Claude Code',
      codex: 'Codex',
      cursor: 'Cursor',
      other: 'Otro',
      paste: 'Pégalo en el chat del agente:',
      terminal: 'Ejecútalo en la terminal del proyecto:',
      manual: 'O a mano:',
    },
    session: 'Un agente escribe en Hollware',
    copyText: 'Copiar',
    copiedText: 'Copiado',
    brand: {
      mark: 'Marca',
      wordmark: 'Marca y nombre',
      onDark: 'Sobre oscuro',
      onLight: 'Sobre claro',
      svg: 'SVG',
      png: 'PNG',
      colors: 'Colores',
      fonts: 'Tipografías',
      carbon: 'Carbón',
      flame: 'Llama',
      sans: 'Texto',
      mono: 'Código',
      sansName: 'Schibsted Grotesk',
      monoName: 'JetBrains Mono',
    },
  },
  docs: {
    label: 'Documentación',
    navigation: 'Documentación',
    sections: {
      start: 'Primeros pasos',
      guides: 'Guías',
      frameworks: 'Frameworks',
      concepts: 'Conceptos',
      reference: 'Referencia',
    },
    previous: 'Anterior',
    next: 'Siguiente',
    onThisPage: 'En esta página',
    markdown: 'Markdown',
    notFound: 'Página no encontrada',
    empty: 'Todavía no hay documentación',
    untranslated: 'Esta página todavía no está traducida al español: la ves en inglés.',
    callout: { note: 'Nota', tip: 'Consejo', warning: 'Atención' },
  },
  readApi: {
    title: 'API de lectura',
    description:
      'Cada endpoint de la API de lectura de Hollware: qué responde y los parámetros que recibe.',
    intro: (endpoints: number) =>
      `Los ${endpoints} endpoints de /v1, que un sitio fuera de Cloudflare lee con un token de lectura. Cada uno responde JSON con un ETag, y 304 cuando nada cambió desde entonces; un token de preview lee la última revisión de una entrada. Un despliegue sirve lo mismo, como OpenAPI, en /v1/openapi.json.`,
    untranslated: 'Las descripciones son las que entrega el servidor, en inglés.',
    answers: 'Responde:',
    parameter: 'Parámetro',
    in: 'En',
    about: 'Qué es',
  },
  events: {
    title: 'Eventos de webhooks',
    description:
      'Cada evento que recibe un webhook de Hollware: cuándo se envía, sus campos y cómo verificarlo.',
    intro:
      'Un sitio lista sus webhooks en sus eventos. Cada cambio envía un evento a cada uno, como JSON en un POST, firmado con el secreto del webhook. parseHollwareEvent de @hollware/core lee uno, y verifyWebhook verifica su firma.',
    untranslated: 'Las descripciones de los campos son las del código, en inglés.',
    delivery: 'Entrega',
    deliveryBody:
      'Un evento se escribe en el mismo lote que el cambio que cuenta, y después se envía por la cola: un webhook que responde un error lo recibe de nuevo, hasta cinco veces. Los eventos de una revisión llegan a los webhooks en la siguiente pasada del cron, en menos de un minuto. Quien recibe usa el id de un evento para ignorar uno que ya tiene.',
    eventHeader: 'el id del evento, el mismo en cada reintento',
    timestampHeader:
      'cuándo se firmó, en segundos; verifyWebhook rechaza uno que esté a más de cinco minutos',
    signatureHeader:
      'v1= y el HMAC-SHA256 del timestamp, un punto y el cuerpo, con el secreto del webhook',
    field: 'Campo',
    type: 'Tipo',
    about: 'Qué es',
  },
  tools: {
    title: 'Herramientas MCP',
    description:
      'Cada herramienta del servidor MCP de Hollware: qué hace, los scopes que necesita y su entrada.',
    intro: (tools: number) =>
      `Las ${tools} herramientas de /mcp, tal como tools/list se las describe a un cliente con todos los scopes. Un token personal lista solo las que sus scopes permiten, y un cliente OAuth las lista todas; una llamada sin el scope recibe un 403 que dice cuál falta.`,
    untranslated:
      'Las descripciones de las herramientas son las que entrega el servidor, en inglés.',
    input: 'Esquema de entrada',
  },
}

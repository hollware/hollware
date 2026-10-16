import type { Messages } from './en'

/** The words of hollware.com in neutral Spanish: no regional idioms, the reader as tú. */
export const es: Messages = {
  language: { name: 'Español', switch: 'Read in English', switchTo: 'English' },
  seo: {
    home: 'Hollware: el CMS en el que escriben tus agentes',
    description:
      'Hollware es un CMS headless de código abierto en Cloudflare Workers. Los agentes escriben Markdown por MCP, los contratos revisan cada escritura y tus sitios lo leen por Workers RPC.',
  },
  nav: {
    docs: 'Documentación',
    tools: 'Herramientas',
    demo: 'Demo',
    github: 'Hollware en GitHub',
  },
  footer:
    'Hollware es de código abierto, con licencia MIT. Hecho para agentes, cuidado por personas.',
  copy: { copy: 'Copiar el comando', copied: 'Copiado' },
  home: {
    badge: 'v0.8 · código abierto · Cloudflare Workers',
    title: 'El CMS en el que escriben tus agentes',
    description:
      'Hollware es un CMS headless nativo de Cloudflare Workers. Los agentes escriben Markdown por MCP, los contratos revisan cada escritura, D1 guarda el contenido y tus sitios lo leen por Workers RPC.',
    readDocs: 'Leer la documentación',
    why: {
      headline: 'Por qué Hollware',
      title: 'Contenido que los agentes pueden escribir y en el que puedes confiar',
      description:
        'Cada escritura pasa por las mismas revisiones, la haga quien la haga: un agente, una persona en el admin o un script.',
    },
    features: {
      contracts: {
        title: 'Contratos en cada escritura',
        description:
          'El esquema de tu frontmatter, tus componentes y las reglas que eliges de un catálogo revisan cada borrador. Un borrador que no cumple una regla se guarda igual, con la corrección que un agente puede aplicar.',
      },
      mcp: {
        title: 'MCP de forma nativa',
        description: (tools: number) =>
          `${tools} herramientas en las dos revisiones del protocolo, con tokens personales u OAuth. Claude Code, claude.ai y cualquier cliente MCP pueden escribir en él.`,
      },
      truth: {
        title: 'Una sola fuente de verdad',
        description:
          'D1 guarda cada entrada y cada revisión, sin borrar nunca. El Markdown entra y sale idéntico, byte por byte, sin quedar atrapado en un formato propio.',
      },
      edge: {
        title: 'Lectura en el borde',
        description:
          'Un Worker lee el contenido publicado por un service binding: sin red y sin token. Las páginas quedan en el borde y se purgan por etiqueta en cuanto publicas.',
      },
      people: {
        title: 'Las personas siguen al mando',
        description:
          'Passkeys, roles por sitio y una cola de revisión: el agente de un autor pide publicar, y un editor aprueba el diff en el admin.',
      },
      yours: {
        title: 'Lo administras tú',
        description:
          'Se despliega en tu propia cuenta de Cloudflare con un solo comando, pensado para los límites del plan gratuito. Licencia MIT, sin ningún servicio de por medio.',
      },
    },
    steps: {
      headline: 'Tres comandos',
      title: 'De cero a publicado',
      create: {
        title: 'Crea un proyecto',
        description:
          'Un Worker y una base de datos local, con tu sitio a partir de una plantilla, su dueño y un token.',
      },
      connect: {
        title: 'Conecta tu agente',
        description: 'Lee tu sitio con describe_site y luego escribe, valida y publica borradores.',
      },
      deploy: {
        title: 'Despliégalo',
        description:
          'Hollware crea su base de datos, su namespace y sus colas en tu cuenta, y aplica las migraciones.',
      },
    },
    shaping: {
      headline: 'Sin desplegar',
      title: 'Da forma a tu contenido sobre la marcha',
      description:
        'Tus colecciones, sus campos y sus reglas viven junto a tu contenido. Cámbialos en el admin o deja que lo haga un agente por MCP: te dice qué le haría un cambio a las entradas que ya tienes, y se aplica al instante.',
      link: 'Configurar tu contenido',
      comment: '// Un agente agrega un campo obligatorio al blog, por MCP',
      answer: [
        '// → needs_confirmation: 3 entradas no tienen subtitle.',
        '//   Confírmalo, y cada escritura posterior se revisa con él.',
      ],
    },
    cta: {
      title: 'Dales un CMS a tus agentes',
      description: 'Funcionando en tu propia cuenta de Cloudflare en unos minutos.',
    },
  },
  docs: {
    label: 'Documentación',
    navigation: 'Documentación',
    sections: {
      start: 'Primeros pasos',
      guides: 'Guías',
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
  tools: {
    title: 'Herramientas MCP',
    description:
      'Cada herramienta del servidor MCP de Hollware: qué hace, los scopes que necesita y su entrada.',
    intro: (tools: number) =>
      `Las ${tools} herramientas de /mcp, tal como las describe tools/list. Cada herramienta revisa sus scopes al ejecutarse: un token que no los tiene recibe un 403 que dice cuáles faltan.`,
    untranslated:
      'Las descripciones de las herramientas son las que entrega el servidor, en inglés.',
    input: 'Esquema de entrada',
  },
}

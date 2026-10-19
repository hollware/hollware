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
    badge: (version: string) => `v${version} · código abierto · Cloudflare Workers`,
    title: 'El CMS en el que escriben tus agentes',
    description:
      'Tus agentes escriben tu contenido en Markdown. Hollware revisa cada cambio con tus reglas, deja que las personas aprueben lo que se publica y lo sirve desde la red de Cloudflare segundos después de publicar.',
    readDocs: 'Leer la documentación',
    demo: 'Ver la demo',
    flow: {
      headline: 'Cómo funciona',
      title: 'De un prompt a una página publicada, con revisiones en el medio',
      description:
        'Hollware está entre quien escribe y el sitio que lo muestra. Cada escritura sigue el mismo camino, venga de un agente, de una persona en el admin o de un script.',
      steps: [
        {
          title: 'Un agente escribe',
          description:
            'Claude Code, claude.ai o cualquier cliente MCP lee la estructura de tu sitio y escribe borradores en Markdown.',
          detail: 'create_draft',
        },
        {
          title: 'Hollware revisa',
          description:
            'Cada escritura se revisa con el esquema y las reglas de su colección. Un borrador que falla se guarda igual, con la corrección que el agente aplica después.',
          detail: 'verdict + fix',
        },
        {
          title: 'Una persona aprueba',
          description:
            'Un agente sin permiso para publicar pide una revisión. Un editor lee el diff en el admin y lo aprueba o pide cambios.',
          detail: 'request_review',
        },
        {
          title: 'Tu sitio lo muestra',
          description:
            'Publicar purga las páginas que cambiaron. Tu sitio lee el contenido nuevo por Workers RPC y queda en línea en segundos, sin rebuild.',
          detail: 'publish',
        },
      ],
    },
    benefits: {
      headline: 'Por qué Hollware',
      title: 'Deja que los agentes escriban y mantén el control de lo que se publica',
      description:
        'Un agente escribe rápido y se equivoca. Hollware hace que sus errores salgan baratos: los encuentra, los explica y los mantiene lejos de tus lectores.',
      items: {
        contracts: {
          title: 'Los agentes no pueden romper tu sitio',
          description:
            'El esquema de tu frontmatter, tus componentes y las reglas que eliges revisan cada borrador. Lo que falla nunca llega a publicarse, y el agente sabe cómo corregirlo.',
        },
        history: {
          title: 'Cada cambio se puede deshacer',
          description:
            'Cada revisión se guarda sin borrar nunca. Compara dos, restaura cualquiera, recupera una entrada borrada desde la papelera y ten un respaldo de cada día.',
        },
        people: {
          title: 'Las personas deciden qué se publica',
          description:
            'Passkeys, roles por sitio y una cola de revisión. Un token solo hace lo que permiten sus scopes y lo que su persona todavía puede hacer hoy.',
        },
        live: {
          title: 'En línea en segundos, sin rebuild',
          description:
            'Sin esperar un CI ni un build estático: publicar purga las páginas en caché por etiqueta, y la siguiente visita lee la versión nueva.',
        },
        yours: {
          title: 'Tu contenido sigue siendo tuyo',
          description:
            'El Markdown entra y sale idéntico, byte por byte. Expórtalo cuando quieras y córrelo en tu propia cuenta con licencia MIT.',
        },
        free: {
          title: 'Gratis para empezar',
          description:
            'Pensado para los límites del plan gratuito de Cloudflare: un blog o un sitio de documentación funcionan sin pagar nada y sin un servidor que cuidar.',
        },
      },
    },
    different: {
      headline: 'Qué lo hace distinto',
      title: 'Hecho para agentes, no adaptado a ellos',
      description:
        'Hollware se diseñó desde la primera línea para un mundo en el que la mayoría de las escrituras vienen de un agente y una persona tiene la última palabra.',
      items: {
        agents: {
          title: 'Los agentes son usuarios de primera clase',
          description: (tools: number) =>
            `MCP es la puerta principal, no un plugin: ${tools} herramientas, scopes en cada una, OAuth o tokens personales, y errores que dicen cómo corregirlos.`,
        },
        rules: {
          title: 'Las reglas viven con el contenido',
          description:
            'Colecciones, campos y reglas son datos, no código. Cámbialos en el admin o por MCP sin desplegar, y un agente los aprende con una sola llamada.',
        },
        operate: {
          title: 'Nada que operar',
          description:
            'Sin servidor, sin contenedor y sin base de datos que parchar. Es un solo Worker en tu cuenta, y Cloudflare lo corre en cada región.',
        },
        reads: {
          title: 'Los sitios lo leen sin salir a la red',
          description:
            'Tu sitio es un Worker conectado a Hollware: lee el contenido publicado de Worker a Worker, sin una API key que guardar en el sitio.',
        },
      },
    },
    cloudflare: {
      headline: 'Nativo de Cloudflare',
      title: 'Cada pieza es un producto de Cloudflare',
      description:
        'Hollware es un solo Worker que arma la plataforma. Se despliega en tu propia cuenta con un comando, y nada corre fuera de ella.',
      optional: 'Opcional',
      diagram: {
        writers: 'Agentes, personas y scripts',
        writersVia: 'MCP · HTTP · admin',
        hollware: 'Hollware, un solo Worker',
        site: 'Tu sitio, un Worker',
        siteVia: 'service binding · RPC',
        readersVia: 'HTTPS · caché en el borde',
        readers: 'Lectores, desde la ubicación más cercana',
      },
      products: {
        workers: 'El CMS, su servidor MCP, su API HTTP y el inicio de sesión, en un solo Worker.',
        d1: 'Entradas, cada revisión, personas y la bitácora de auditoría: la única fuente de verdad.',
        r2: 'Las imágenes y sus originales, y un respaldo de cada día.',
        images: 'Redimensiona cada imagen a los anchos de su srcset.',
        rpc: 'Tu sitio lee el contenido publicado de Worker a Worker, sin token.',
        cache: 'Guarda las páginas en el borde y las descarta por etiqueta al publicar.',
        queues: 'Entrega webhooks y eventos, con reintentos y una dead letter queue.',
        cron: 'Publica lo que programaste y corre el respaldo diario.',
        kv: 'Guarda los permisos OAuth de los agentes que conectas.',
        assets: 'Sirve el admin, ya compilado, sin despertar al Worker.',
        ai: 'Búsqueda semántica y entradas relacionadas, entre idiomas.',
        analytics:
          'Cuenta visitas sin datos personales, para que los agentes sepan qué actualizar.',
      },
    },
    cases: {
      headline: 'Casos de uso',
      title: 'Un CMS, muchas formas de trabajar',
      description:
        'Las mismas piezas sirven para el blog de una persona, un equipo con editores o una documentación que los agentes mantienen al día.',
      items: [
        {
          label: 'Un blog personal',
          title: 'Escribes con tu agente',
          description:
            'Pide un post con tus propias palabras. El agente lo redacta, corrige lo que marcan las reglas, y tú publicas desde el admin o desde el chat.',
          steps: [
            'Le pides a Claude Code un post sobre lo que construiste esta semana',
            'Lo redacta en Markdown y corrige lo que marcan los contratos',
            'Lees la vista previa en tu propio sitio',
            'Publicas, y queda en línea en segundos',
          ],
        },
        {
          label: 'Un equipo con editores',
          title: 'Los autores escriben, los editores aprueban',
          description:
            'El agente de cada autor puede escribir pero no publicar. Los editores revisan la cola desde el admin, en el escritorio o en el teléfono.',
          steps: [
            'El agente de un autor escribe un borrador y pide revisión',
            'El editor lee el diff, el veredicto y quién lo escribió',
            'Lo aprueba, o comenta y pide cambios',
            'Una revisión nueva necesita una aprobación nueva',
          ],
        },
        {
          label: 'Documentación al día',
          title: 'Documentación que sigue al código',
          description:
            'hollware.com funciona así: sus páginas las escriben en Hollware agentes con un token que no puede publicar, y las aprueba una persona.',
          steps: [
            'Sale un cambio en el código',
            'Un agente actualiza las páginas que toca, en cada idioma',
            'Los links internos deben resolver antes de publicar',
            'Las páginas aprobadas, y su llms.txt, se actualizan solas',
          ],
        },
        {
          label: 'Varios idiomas',
          title: 'Cada idioma, un grupo de entradas',
          description:
            'Las traducciones de una página son entradas enlazadas. Un agente traduce, y una regla puede retener una página hasta que estén todos los idiomas.',
          steps: [
            'Publicas una página en inglés',
            'Un agente traductor escribe el borrador en español, enlazado',
            'La regla de pares de traducción revisa que existan ambas',
            'Tu sitio cambia de idioma con los alternates correctos',
          ],
        },
        {
          label: 'Contenido que mejora',
          title: 'Actualiza lo que más se lee',
          description:
            'Las visitas se cuentan en el borde. Un agente ve lo popular que quedó desactualizado, encuentra las páginas relacionadas y propone una actualización.',
          steps: [
            'content_stats muestra las páginas más leídas',
            'Un agente auditor marca las que están desactualizadas',
            'La búsqueda semántica encuentra qué más actualizar',
            'El borrador nuevo pasa por la misma revisión',
          ],
        },
        {
          label: 'Migrar',
          title: 'Trae el Markdown que ya tienes',
          description:
            'Importa una carpeta de Markdown o un sitio de Nuxt Content. Cada archivo conserva sus bytes y sale igual que entró.',
          steps: [
            'hollware import lee tus archivos',
            'Primero borradores, después publish, y una segunda corrida no cambia nada',
            'Tu sitio los lee con el paquete de Nuxt, Astro, React o Vue',
            'hollware export te devuelve los archivos cuando quieras',
          ],
        },
      ],
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
          'Hollware crea su base de datos, su namespace, sus colas y su bucket de imágenes en tu cuenta, y aplica las migraciones.',
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

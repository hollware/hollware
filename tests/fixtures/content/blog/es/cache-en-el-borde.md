---
title: Cache en el borde
description: Qué guarda una cache en el borde, por cuánto tiempo y cómo la limpia una publicación.
date: 2026-09-01
tags:
  - cloudflare
  - cms
translationGroup: edge-caching
---

# Cache en el borde

Qué guarda una cache en el borde, por cuánto tiempo y cómo la limpia una publicación. Esta entrada es parte del corpus sintético de los tests, así que sus palabras solo tienen que parecer una entrada.

## Por qué importa

Un sitio que publica seguido necesita **lecturas rápidas** y escrituras _predecibles_. Lee [la entrada sobre agentes que escriben con contratos](/blog/agentes-que-escriben-con-contratos/) para la parte relacionada de la historia.

::callout{type="tip"}
Mantén el slug corto: se vuelve parte de la ruta pública.
::

## Cómo funciona

1. Quien escribe guarda un borrador.
2. Los contratos lo revisan y devuelven un veredicto.
3. Publicar hace pública la página.

```ts
const verdict = await validate(markdown)
```

![Un diagrama del flujo](/images/cache-en-el-borde.png)

---
title: Un despliegue, muchos sitios
description: Cómo un despliegue mantiene separado el contenido de cada uno de sus sitios.
date: 2026-09-22
tags:
  - cloudflare
  - cms
translationGroup: site-isolation
---

# Un despliegue, muchos sitios

Cómo un despliegue mantiene separado el contenido de cada uno de sus sitios. Esta entrada es parte del corpus sintético de los tests, así que sus palabras solo tienen que parecer una entrada.

## Por qué importa

Un sitio que publica seguido necesita **lecturas rápidas** y escrituras _predecibles_. Lee [la entrada sobre del borrador a publicado](/blog/del-borrador-a-publicado/) para la parte relacionada de la historia.

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

![Un diagrama del flujo](/images/un-despliegue-muchos-sitios.png)

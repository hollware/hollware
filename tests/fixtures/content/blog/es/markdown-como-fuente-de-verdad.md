---
title: Markdown como fuente de verdad
description: Por qué el CMS guarda el archivo Markdown y deriva todo lo demás de él.
date: 2026-09-15
tags:
  - markdown
translationGroup: markdown-source
---

# Markdown como fuente de verdad

Por qué el CMS guarda el archivo Markdown y deriva todo lo demás de él. Esta entrada es parte del corpus sintético de los tests, así que sus palabras solo tienen que parecer una entrada.

## Por qué importa

Un sitio que publica seguido necesita **lecturas rápidas** y escrituras _predecibles_. Lee [la entrada sobre un despliegue, muchos sitios](/blog/un-despliegue-muchos-sitios/) para la parte relacionada de la historia.

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

![Un diagrama del flujo](/images/markdown-como-fuente-de-verdad.png)

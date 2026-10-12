---
title: Agentes que escriben con contratos
description: Cómo un agente aprende las reglas de un sitio con los errores que recibe mientras escribe.
date: 2026-09-08
tags:
  - agents
  - cms
translationGroup: agents-and-contracts
---

# Agentes que escriben con contratos

Cómo un agente aprende las reglas de un sitio con los errores que recibe mientras escribe. Esta entrada es parte del corpus sintético de los tests, así que sus palabras solo tienen que parecer una entrada.

## Por qué importa

Un sitio que publica seguido necesita **lecturas rápidas** y escrituras _predecibles_. Lee [la entrada sobre markdown como fuente de verdad](/blog/markdown-como-fuente-de-verdad/) para la parte relacionada de la historia.

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

![Un diagrama del flujo](/images/agentes-que-escriben-con-contratos.png)

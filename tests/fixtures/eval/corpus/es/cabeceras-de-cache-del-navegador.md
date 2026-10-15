---
title: Cabeceras de caché en el navegador
description: Cómo Cache-Control y ETag deciden qué guarda el navegador en el propio dispositivo del lector.
date: 2026-09-15
tags:
  - rendimiento
  - http
translationGroup: browser-cache
---

# Cabeceras de caché en el navegador

Antes de cualquier borde, el navegador tiene su propia caché, regida por las cabeceras de cada respuesta.

## Cache-Control

max-age dice cuántos segundos una copia sigue fresca en el dispositivo. no-store no guarda nada, lo correcto para páginas privadas.

## Revalidación

Con un ETag, el navegador pregunta si su copia sigue vigente, y un 304 responde que sí sin mandar el cuerpo otra vez.

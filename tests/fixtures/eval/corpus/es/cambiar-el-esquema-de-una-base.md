---
title: Cambiar el esquema de una base de datos
description: Agregar una columna o una tabla a una base en producción sin botar el sitio.
date: 2026-09-15
tags:
  - bases de datos
  - operaciones
translationGroup: schema-migrations
---

# Cambiar el esquema de una base de datos

Un cambio de esquema corre sobre datos que ya existen, mientras el código anterior puede seguir atendiendo peticiones.

## Solo hacia adelante

Nunca escribas una migración de reversa. Si un cambio estaba mal, una migración nueva lo corrige. Las reversas casi nunca se prueban y pierden datos al correr.

## Expandir y luego contraer

Agrega primero la columna nueva, despliega código que escriba en ambas, rellena, y recién en una versión posterior elimina la columna vieja.

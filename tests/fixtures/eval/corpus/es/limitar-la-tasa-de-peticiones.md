---
title: Limitar la tasa de peticiones
description: Frenar a un cliente que manda demasiadas peticiones antes de que tumbe el servicio.
date: 2026-09-15
tags:
  - operaciones
  - seguridad
translationGroup: rate-limiting
---

# Limitar la tasa de peticiones

Un solo script en un ciclo puede gastar la capacidad pensada para miles de lectores.

## Cubeta de fichas

Cada cliente tiene una cubeta que se rellena a ritmo constante. Cada petición gasta una ficha; con la cubeta vacía toca esperar, y la respuesta es 429.

## Qué clave usar

Limita por cuenta cuando la hay, y por dirección si no. Dile al cliente cuándo reintentar con Retry-After.

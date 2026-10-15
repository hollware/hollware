---
title: Rotar claves de API
description: Reemplazar una clave secreta cada cierto tiempo sin romper a los clientes que la usan.
date: 2026-09-15
tags:
  - seguridad
  - operaciones
translationGroup: api-keys
---

# Rotar claves de API

Una clave que nunca cambia sigue sirviendo para quien la copió, para siempre.

## Dos claves a la vez

Emite la clave nueva, deja que los clientes se cambien, y revoca la vieja solo cuando nada la use.

## Dónde viven las claves

Guarda las claves en un almacén de secretos, nunca en el repositorio. Una clave en el historial de git es una clave filtrada.

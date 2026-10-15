---
title: Verificar las firmas de los webhooks
description: Comprobar que una notificación viene de verdad del servicio que dice haberla enviado.
date: 2026-09-15
tags:
  - seguridad
  - integraciones
translationGroup: webhook-signatures
---

# Verificar las firmas de los webhooks

Un webhook es una petición que cualquier desconocido podría mandar a tu endpoint, así que el cuerpo solo no prueba nada.

## HMAC

El emisor firma la hora y el cuerpo con un secreto compartido. El receptor calcula la misma firma y compara ambas en tiempo constante.

## Repeticiones

Rechaza una firma de más de cinco minutos y recuerda los ids ya procesados, para que el mismo evento nunca cuente dos veces.

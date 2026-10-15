---
title: Fechas entre zonas horarias
description: Guardar un instante una vez y mostrarlo bien a un lector en Santiago y a otro en Tokio.
date: 2026-09-15
tags:
  - i18n
  - backend
translationGroup: time-zones
---

# Fechas entre zonas horarias

Una fecha escrita en hora local significa un momento distinto para cada lector que la ve.

## Guarda en UTC

Guarda cada instante en UTC con su desfase, en ISO 8601. Convierte a la zona del lector solo al mostrarlo.

## Fechas de calendario

Un cumpleaños o un día de publicación es una fecha, no un instante. Guárdala sin hora, o se corre un día para medio mundo.

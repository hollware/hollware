---
title: Purgar la caché del borde
description: Cuándo una página guardada queda vieja y cómo una publicación la limpia en todas partes.
date: 2026-09-15
tags:
  - cloudflare
  - rendimiento
translationGroup: edge-cache-purge
---

# Purgar la caché del borde

Una página guardada en el borde responde rápido, hasta que cambia el contenido detrás y los lectores siguen viendo la copia antigua.

## Tiempo de vida

Cada respuesta guardada tiene una vida útil. Una vida larga ahorra trabajo al origen; una corta muestra los cambios antes. Muchos sitios eligen minutos para el HTML y un año para los archivos con hash.

## Purgar por etiqueta

Etiqueta cada respuesta con la entrada que muestra. Al publicarla de nuevo, purga esa etiqueta y cada centro de datos descarta la página vieja en segundos.

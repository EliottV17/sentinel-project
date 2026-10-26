# Plan de endurecimiento de la interfaz de Sentinel

**Decisión:** se aprueba este documento como base de trabajo; no se autoriza implementar ninguna etapa. El objetivo es corregir primero lo que Sentinel comunica sobre la realidad operativa y después mejorar interacción y lectura sin cambiar su identidad. Las cinco etapas se ejecutarán **secuencialmente**, cada una con aprobación independiente y revisión separada. Aprobar este plan no aprueba la etapa 1 ni autoriza implementar el conjunto.

## Estado y referencias

- [PRODUCT.md](../../PRODUCT.md) y [DESIGN.md](../../DESIGN.md) son referencias que deben respetarse; permanecen intactos.
- Dirección visual vinculante: **Kanso Zen** y **Calmo e instrumental**.
- [Progreso y autorización por etapa](#progreso-y-autorización).
- Las rutas fuente se enlazan respecto de este documento y fueron contrastadas con el código actual; los enlaces no dependen de números de línea.

## Contexto: hallazgos originales de Impeccable

Auditoría de solo lectura por dos agentes (A `mvojzc0s-4-ow3u`; B `mvojzc1s-5-0hem`), sobre el frontend renderizado a 1440, 390 y 320 px con fixtures sintéticos solo en el navegador:

| Hallazgo | Prioridad | Observación original | Etapa |
|---|---:|---|---:|
| F1 | P1 | El historial mostraba `Healthy` para un monitor pausado con último resultado saludable; también omitía la advertencia de frescura para resultados vencidos. No distinguía correctamente estado administrativo, último resultado y vigencia de los datos. | 1 |
| F2 | P2 | Login tenía estados ocupados independientes; permitía solicitudes regular/demo simultáneas y la etiqueta `Sign in` no cambiaba durante el envío. | 2 |
| F3 | P2 | Unidad `ms` y marca superior del eje se solapaban; la instrucción decía “44-pixel-high” y la guía era verbosa. | 3 |
| F4 | P2 | El color de texto de error real `#c4746e` sobre `danger-soft` `#392523` tenía contraste aproximado de 4,15:1, inferior a 4,5:1. | 4 |
| F5 | P2 | En móvil, la cabecera persistente se envolvía, las acciones de las tarjetas consumían altura y la etiqueta de historial se estiraba. | 5 |

La auditoría no demostró corrupción de autenticación en producción ni ningún P0. El detector terminó con código 0 y `[]`; eso no constituye certificado UX ni WCAG. El placeholder sutil sobre `canvas` (aprox. 4,58:1) pasa y no es un hallazgo de superficie de error.

## Límites comunes

- Preservar **Kanso Zen**, «Calmo e instrumental», las tarjetas y la combinación serif/monoespaciada.
- Mantener `PRODUCT.md` y `DESIGN.md` intactos como referencias.
- No incorporar dependencias, bibliotecas de componentes, nuevos proveedores de estado ni cambios de arquitectura.
- No modificar contratos de API, autenticación del servidor ni comportamiento del worker.
- No agregar funciones ajenas a los hallazgos: búsqueda, acciones masivas, nuevos menús o controles de pausa/reanudación.
- Aprovechar componentes, utilidades y pruebas existentes; evitar abstracciones nuevas salvo necesidad demostrada.

## Orden de ejecución

| Etapa | Resultado esperado | Impacto |
|---|---|---|
| **1. Fidelidad del estado operativo** | Distinguir administración, último resultado y frescura | Confiabilidad |
| **2. Acceso login/demo** | Una sola operación de acceso en curso y feedback explícito | Prevención de ambigüedad |
| **3. Lectura del historial** | Gráfico legible e instrucciones breves, sin perder rigor | Interpretación |
| **4. Contraste de errores** | Mensajes y etiquetas de fallo suficientemente legibles | Accesibilidad |
| **5. Ergonomía móvil** | Más espacio útil conservando tarjetas y controles familiares | Operación móvil |

## Etapa 1 — Fidelidad del estado operativo

### Alcance

Revisar la presentación en dashboard e historial para distinguir tres dimensiones:

1. **Estado administrativo:** activo o pausado.
2. **Último resultado conocido:** saludable, no saludable o sin comprobaciones.
3. **Frescura:** cuándo se obtuvo ese resultado y si quedó fuera del umbral esperado.

Usar los componentes existentes, texto contextual y marcas temporales. No crear otro sistema de estados ni un nuevo panel.

**Superficies principales:** [`MonitorHistoryPage.tsx`](../../frontend/src/features/monitors/history/MonitorHistoryPage.tsx), [`MonitorRow.tsx`](../../frontend/src/features/monitors/MonitorRow.tsx) y su integración con [`StatusPill.tsx`](../../frontend/src/features/monitors/StatusPill.tsx). Reutilizar [`isEngineStale`](../../frontend/src/lib/datetime.ts); no cambiar su regla por defecto.

### Comportamiento esperado

| Situación | Presentación esperada |
|---|---|
| Pausado, último resultado saludable | `Paused` como estado administrativo; resultado saludable identificado como anterior |
| Pausado, último resultado no saludable | `Paused`; último resultado no saludable conservado como contexto |
| Activo, resultado reciente | Último resultado y momento de comprobación claramente identificados |
| Activo, resultado vencido | Resultado anterior acompañado de advertencia de falta de comprobaciones recientes |
| Sin comprobaciones | `Never checked` o equivalente existente; nunca apariencia de salud confirmada |
| Error al actualizar desde la API | Advertencia de actualización fallida y conservación explícita de los datos anteriores |

**Un fallo de API y datos de comprobación vencidos no son equivalentes.** Tampoco la falta de comprobaciones demuestra por sí sola que el worker se cayó.

### Criterios de aceptación

- Dashboard e historial comunican coherentemente el mismo monitor.
- Un monitor pausado no afirma que las comprobaciones siguen ejecutándose.
- Un resultado saludable antiguo no parece una confirmación de salud actual.
- Los contadores no se presentan como garantía de frescura si contabilizan últimos resultados.
- Se conserva el umbral actual: **antigüedad > `2 × max(frecuencia, 30 segundos)`**.
- Para frecuencia de 60 segundos: a los 120 segundos exactos no se supera el umbral; después, sí.
- La frescura se reevalúa con el paso del tiempo aunque las respuestas sean idénticas. No se introduce un reloj global de un segundo ni se aumenta el tráfico de API.

### Verificación

Extender las pruebas de historial, filas y etiquetas con los casos anteriores y tiempo controlado. Comprobar respuestas idénticas, errores de actualización y recuperación.

**Esta etapa debe cerrarse antes de avanzar:** es la prioridad del plan.

### Resultado observado de la etapa 1

- Implementada y verificada sobre `88f2e35`, sin commits. Dashboard e historial conservan el estado `Paused`, el resultado conocido y su momento; los resultados vencidos tienen una advertencia sin atribuir una caída al worker. Los contadores dicen `Last known healthy`, `Last known unhealthy` y `Never checked`.
- `useMonitorFreshness` reevalúa localmente el tiempo: próximo vencimiento futuro + 1 ms o cadencia de 30 s, con limpieza al desmontar. No cambia `isEngineStale`, los endpoints ni el polling. La inyección de `now` sigue siendo determinista.
- Evidencia de tiempo controlado: a 120 000 ms no hay advertencia y a 120 001 ms sí. Se comprueban 13 respuestas idénticas del dashboard (inicio + 12 intervalos de 10 s) y 5 por endpoint del historial (inicio + 4 intervalos de 30 s), sin solicitudes adicionales al vencer el resultado.
- Se verifican pausados saludables/no saludables/sin comprobaciones, activos recientes/vencidos/sin comprobaciones, conservación de datos ante errores y recuperación. La recuperación de API con el mismo resultado antiguo elimina solo el error de actualización; un resultado reciente elimina además la advertencia de frescura.
- Pruebas focalizadas: 6 archivos, 66 pruebas aprobadas. Suite final: `VITE_ISOLATED_BUILD=1 bun run test`, **32 archivos y 246 pruebas aprobadas**, código 0. `bun run typecheck`, build aislado (`VITE_ISOLATED_BUILD=1 bun run build`) y `bun run lint`: código 0. `git diff --check`: código 0.
- Chromium aislado con fixtures únicamente en el navegador: 21 capturas de dashboard e historial a 1440, 390 y 320 px; sin desbordamiento global, excepciones ni fallos de las aserciones de estado. Se inspeccionaron capturas representativas de dashboard, pausado saludable, resultado vencido y sin comprobaciones. Detector Impeccable: `[]`. Esto no certifica WCAG ni sustituye las etapas visuales pendientes.
- Fallos intermedios corregidos: contexto de resultado ausente (RED inicial), timer de 1 ms tras el vencimiento (RED/GREEN), aserciones de recuperación antes de entregar notificaciones de TanStack Query y una expectativa antigua de contadores en `MonitorDesign.test.tsx` (primera suite: 245/246; suite final: 246/246). No quedan verificaciones de la etapa 1 fallidas o pendientes.
- Límites de herramientas: ASSESS nativo no pudo formar un candidato por archivos sin seguimiento; con RDD desactivado devolvió autoverificación y no exigió verificador independiente. Se conservan avisos de Node sobre `localStorage`, `act` en pruebas existentes de autenticación y de build sobre anotaciones de Zod/tamaño de chunk; no se amplió el alcance para corregirlos. No se ejecutaron pruebas de API/worker ni verificaciones contra datos reales porque no se modificaron esas superficies.
- Evidencia local ignorada: `.pi/stage1-verification/` (logs, script, resultados y capturas). El primer intento del worker dejó una caché `.vite/` en `node_modules/` de la raíz; se preservó sin borrar archivos. `PRODUCT.md` y `DESIGN.md` mantienen sus hashes originales. Las etapas 2–5 siguen sin autorización.

## Etapa 2 — Acceso login/demo consistente

### Alcance

Alinear login con la protección de operación en curso que ya existe en registro, sin cambiar el almacenamiento de tokens, los endpoints ni las reglas de sesión.

**Superficie principal:** [`LoginPage.tsx`](../../frontend/src/features/login/LoginPage.tsx) y sus pruebas.

### Cambios previstos

- Impedir que login y demo se ejecuten simultáneamente.
- Deshabilitar ambas alternativas mientras una esté pendiente.
- Mostrar qué operación está trabajando.
- Recuperar los controles después de un error, conservando los datos ingresados.
- Mantener el destino de navegación y los errores específicos existentes.

### Criterios de aceptación

- Login pendiente bloquea demo, y viceversa.
- Clics rápidos alternados generan una sola solicitud.
- El estado pendiente se comunica con texto, no solamente mediante deshabilitación.
- Un error permite reintentar sin perder el formulario.
- Registro conserva su comportamiento actual.

### Verificación

Pruebas con respuestas demoradas, éxito, credenciales inválidas y demo no disponible. Por tocar la coordinación del acceso, esta etapa merece una revisión independiente acotada a ese comportamiento.

## Etapa 3 — Gráfico de historial preciso y fácil de leer

### Alcance

Corregir la geometría y la presentación de instrucciones en [`LatencyChart.tsx`](../../frontend/src/features/monitors/history/LatencyChart.tsx), sin sustituir el gráfico ni alterar sus cálculos.

### Cambios previstos

- Separar la unidad `ms` del valor superior del eje, reservando espacio dentro del SVG para evitar superposición o recorte.
- Sustituir la referencia a “44-pixel-high” por una instrucción orientada a la tarea.
- Mantener visible la distinción esencial entre **ausencia de muestras y caída del servicio**.
- Dejar los detalles del cálculo disponibles mediante divulgación progresiva accesible, usando mecanismos nativos cuando alcancen.

### Criterios de aceptación

- Unidad y valores no se superponen en escritorio ni móvil.
- La instrucción principal es breve y el gráfico mantiene protagonismo.
- Se preservan selección por puntero, teclado, flechas, Home y End.
- No cambian puntos, orden temporal, segmentos ni umbrales de huecos.
- No se simplifica el texto hasta afirmar incorrectamente que un hueco representa downtime.

### Verificación

Pruebas existentes de selección y muestras, más comprobación geométrica y revisión renderizada a 1440, 390 y 320 px.

## Etapa 4 — Contraste suficiente sin deriva del sistema visual

### Alcance

Corregir las combinaciones de texto pequeño de error sobre fondos semánticos que hoy alcanzan aproximadamente **4,15:1**.

### Estrategia

**No cambiar globalmente `--color-danger` dejando `DESIGN.md` desactualizado.** Primero resolver las combinaciones afectadas con colores ya definidos, conservando identificación textual, iconografía y tratamiento de error.

No modificar combinaciones que ya cumplen, como los placeholders sobre `canvas`.

### Criterios de aceptación

- Texto normal de error y etiquetas afectadas alcanzan **al menos 4,5:1**.
- La solución conserva la tonalidad contenida y no depende exclusivamente del color.
- No aparecen valores cromáticos arbitrarios dispersos por componentes.
- Los tokens canónicos y documentos permanecen intactos.
- Si los colores existentes no permiten una solución coherente, se presenta esa limitación antes de ampliar el alcance.

### Verificación

Medir las combinaciones reales renderizadas y revisar errores de login, registro, creación y estados no saludables. Comprobar las superficies que compartan el tratamiento para evitar regresiones.

## Etapa 5 — Optimización móvil conservando las tarjetas

### Alcance

Ajustar [`AppShell.tsx`](../../frontend/src/app/AppShell.tsx), la distribución de [`MonitorRow.tsx`](../../frontend/src/features/monitors/MonitorRow.tsx) y la cabecera del historial. **Sin cambiar a tabla, introducir otra estética ni agregar un menú de cuenta por defecto.**

### Cambios previstos

- Reducir el costo vertical persistente de la cabecera.
- Mantener cuenta y salida identificables, con distribución controlada para nombres largos.
- Compactar espacios y acciones redundantes de las tarjetas antes de reducir tamaños de texto.
- Mantener la etiqueta de estado con ancho intrínseco.
- Conservar el nombre completo del monitor en la confirmación y el nombre accesible de las acciones.

### Criterios de aceptación

- Sin desbordamiento global a 320 y 390 px.
- Cabecera compacta cuando haya espacio, con un fallback legible cuando no lo haya; sin forzar una única fila a cualquier costo.
- Más espacio útil sin achicar indebidamente los objetivos táctiles.
- Navegación al historial y eliminación claramente diferenciadas.
- Se preservan confirmación de borrado, cancelación, teclado y restauración del foco.
- Sin regresiones en escritorio ni al ampliar la interfaz.

### Verificación

Comparación visual antes/después con nombres y cuentas largos, tarjetas normales y advertencias, formulario abierto y errores. Revisar también navegación por teclado y zoom al 200 %.

## Cómo se cerraría cada etapa

Una vez autorizado el trabajo:

1. Agregar la prueba que reproduce el defecto antes de corregirlo, cuando sea determinista.
2. Aplicar el cambio mínimo.
3. Ejecutar pruebas focalizadas y verificaciones aplicables.
4. Revisar el renderizado cuando cambie la presentación.
5. Entregar el resultado y sus límites como unidad separada, sin mezclar pendientes de otras etapas.

Al finalizar el conjunto, ejecutar la suite del frontend, comprobación de tipos y build, además de una revisión visual integrada. **Estos controles están planificados; no se ejecutaron al preparar este documento.**

## Progreso y autorización

Cada etapa se ejecutará solo después de completar la anterior y recibir aprobación explícita e independiente para esa etapa. La transición de **Pendiente → En ejecución** requiere esa autorización específica y que la etapa anterior esté completada (la etapa 1 no tiene etapa previa). **En ejecución → Completada** solo procede cuando sus verificaciones se hayan observado y registrado. Un resultado fallido o parcial no se marca completado: registrar evidencia, bloqueos y verificaciones omitidas. Cerrar una etapa no autoriza la siguiente. Este plan no concede permiso para crear commits.

| Etapa | Estado | Aprobación de implementación | Evidencia / resultados |
|---|---|---|---|
| Etapa 1 — Fidelidad del estado operativo | Completada | Autorizada explícitamente por el usuario; sin commits | Supuestos contrastados antes de implementar. Suite final 246/246; tipos, build aislado, lint y diff-check aprobados; 21 capturas Chromium y detector `[]`. Véase «Resultado observado de la etapa 1». |
| Etapa 2 — Acceso login/demo consistente | Pendiente | No autorizada | — |
| Etapa 3 — Gráfico de historial | Pendiente | No autorizada | — |
| Etapa 4 — Contraste de errores | Pendiente | No autorizada | — |
| Etapa 5 — Optimización móvil | Pendiente | No autorizada | — |

### Registro de actualización

- Plan aprobado como base de trabajo y guardado por pedido del usuario; inicialmente la implementación de las cinco etapas permanecía sin autorizar.
- El usuario autoriza exclusivamente la etapa 1: «Implementa únicamente la etapa 1 siguiendo sus criterios de aceptación y verificaciones. No avances a las demás etapas ni hagas commits». Se contrastaron los supuestos con el código antes de implementar; `PRODUCT.md` y `DESIGN.md` permanecen intactos. Las etapas 2–5 siguen sin autorización.
- Etapa 1 cerrada tras observar la suite final 246/246 y las verificaciones registradas arriba. No se crearon commits ni se avanzó a otra etapa.

## Hechos técnicos contrastados y decisiones futuras

- En [`datetime.ts`](../../frontend/src/lib/datetime.ts), `isEngineStale` devuelve `false` si `lastCheckedAt` es `null`; de otro modo usa comparación estricta `ageSeconds > max(frequencySeconds, 30) × 2`. `parseApiDate` interpreta marcas sin zona como UTC.
- [`MonitorRow`](../../frontend/src/features/monitors/MonitorRow.tsx) recibe `now` como prop; [`MonitorList`](../../frontend/src/features/monitors/MonitorList.tsx) le pasa `new Date()` como valor predeterminado durante render. [`useMonitors`](../../frontend/src/features/monitors/useMonitors.ts) usa `VITE_POLL_INTERVAL_MS` o 10 000 ms por defecto y 30 000 ms de backoff de error. [`useMonitorHistory`](../../frontend/src/features/monitors/history/useMonitorHistory.ts) define `REFRESH_MS = 30_000` y considera errores terminales/cooldown en su política de polling.
- Una respuesta idéntica no garantiza un nuevo render que reevalúe el tiempo. En la etapa 1 se implementó [`useMonitorFreshness`](../../frontend/src/features/monitors/useMonitorFreshness.ts), utilizado por cada fila y por el historial: programa el próximo vencimiento futuro + 1 ms o una actualización local cada 30 s y limpia el timer. No hay reloj global de un segundo ni tráfico adicional a la API. Los resultados ya vencidos, las pausas y las fechas inválidas no crean un bucle de timers.
- En `LatencyChart.tsx`, la selección existente contempla puntero y teclado (`ArrowLeft`, `ArrowRight`, `Home`, `End`). [`buildLatencyChartGeometry`](../../frontend/src/features/monitors/history/chart-geometry.ts) usa `timestamp delta > 3 × frecuencia actual` para los huecos; esto es una heurística distinta del umbral de frescura. No se propone cambiarla.
- La etapa 4 no cambiará el token global de peligro mientras la documentación de diseño deba seguir intacta; se priorizan combinaciones locales con la paleta existente. Si no bastan, se presenta la limitación antes de ampliar alcance.
- El detalle de implementación para registrar en pantalla la operación activa de login/demo aún es futuro; el código actual tiene `demoSubmitting` y `isSubmitting` separados y el texto principal `Sign in`. [`RegisterPage.tsx`](../../frontend/src/features/register/RegisterPage.tsx) ya combina ambos estados para deshabilitar acciones y utiliza `busyRef` para impedir operaciones concurrentes. El plan no afirma que esa coordinación ya exista en login.

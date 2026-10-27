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

### Resultado observado de la etapa 2

- **Completada exclusivamente en `feat/sentinel-ui-hardening`**, sobre la base `10e1fc2`. `LoginPage` comparte un estado de operación activa (`login` / `demo` / ninguna) y un bloqueo síncrono mediante ref. Ambas alternativas quedan deshabilitadas mientras una solicitud está pendiente; la activa muestra `Signing in…` u `Opening demo…`. El bloqueo se libera en `finally`, también ante errores.
- Se preservaron el formulario, los mensajes específicos existentes, el destino de navegación, el almacenamiento de tokens, los endpoints y las reglas de sesión. Registro no fue modificado y sus **15 pruebas** siguen aprobadas. No se cambiaron estilos, tokens, dependencias, API ni worker; `PRODUCT.md` y `DESIGN.md` conservan sus hashes originales.
- **RED observado:** `cd frontend && bun run test -- src/features/login/LoginPage.test.tsx src/features/register/RegisterPage.test.tsx` terminó con código 1: 3 fallos y 23 pruebas aprobadas (sin etiqueta pendiente de login, demo no bloqueaba login y los envíos rápidos despachaban tres solicitudes). **GREEN:** el mismo comando terminó con código 0, **27/27** pruebas: 12 de login y 15 de registro. Se cubren respuestas demoradas, exclusión mutua, activaciones alternadas en el mismo turno, envíos duplicados del formulario, éxito, credenciales inválidas, demo no disponible y reintentos. Las pruebas comprueban solicitud única, navegación, token y recuperación; el navegador también confirmó conservación de usuario y contraseña tras fallar cualquiera de las operaciones.
- **Verificación completa del frontend:** `bun run test` aprobó **32 archivos y 250/250 pruebas**; `bun run typecheck`, `bun run build`, `bun run lint` y `git diff --check` terminaron con código 0. El orquestador repitió la comprobación de tipos como contraste del resultado delegado. No corresponde una comparación diferencial de comandos CLI: no se agregaron comandos/opciones ni se modificaron parsers o helpers compartidos.
- **Renderizado aislado:** Chromium con fixtures de autenticación únicamente en el navegador, sin API ni cuentas reales: **18 capturas** a **1440, 390 y 320 px**, cubriendo reposo, login/demo pendiente y errores; reintento y éxito comprobados para ambas alternativas en cada ancho. Sin excepciones, desbordamiento global ni fallos de aserciones. Se inspeccionaron visualmente login pendiente a 320 px, demo pendiente a 390 px, credenciales inválidas a 1440 px y demo no disponible a 320 px. Detector Impeccable: código 0 y `[]`; no es una certificación WCAG. Evidencia local ignorada en `.pi/stage2-verification/`; servidor y Chromium de verificación detenidos.
- **Revisión independiente acotada:** aprobó los **cinco criterios**, sin bloqueos, y repitió las pruebas focalizadas con **27/27** aprobadas. ASSESS, con RDD desactivado, exigió autoverificación y verificador independiente por **riesgo 4: concurrencia**; no indicó revisión nativa pendiente (`reviewDue: false`).
- **Desviaciones y límites:** sin ampliaciones del alcance. La validación asíncrona del formulario puede permitir que demo obtenga primero el bloqueo si ambos botones se activan en el mismo instante; se mantiene una sola solicitud, sin prometer prioridad al primer clic. Persisten los avisos existentes de Node sobre `localStorage` y de build sobre anotaciones de Zod/tamaño de chunk. El contraste conocido de errores corresponde a la etapa 4 y no se corrigió aquí. No se ejecutaron pruebas de API/worker, pruebas contra producción ni comprobaciones con lectores de pantalla o navegadores distintos de Chromium. No quedan verificaciones de la etapa 2 fallidas o pendientes.
- **Unidad de commit y reversión:** código, pruebas y estos resultados forman un único commit independiente de etapa 2, con mensaje `fix(login): serialize sign-in and demo access (stage 2)`. La reversión de esa unidad retira solo esta coordinación y su evidencia, sin afectar la etapa 1. No se hizo push ni se abrió PR; las etapas 3–5 permanecen pendientes y sin autorización.

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

### Resultado observado de la etapa 3

- **Completada exclusivamente en `feat/sentinel-ui-hardening`**, sobre la base limpia `15771da`. `LatencyChart` reserva una franja de 24 unidades dentro del SVG y ubica `ms` por encima de la marca superior, sin tocar las coordenadas de los datos ni `chart-geometry.ts`. La instrucción principal dice `Select a check using the plot or the slider below.`; la nota `Gaps mean missing samples, not confirmed downtime.` permanece visible.
- Los detalles del cálculo y la referencia a la tabla pasan al desplegable nativo **How to read this chart**, cerrado inicialmente, con foco visible y activación por teclado. Se conservan el umbral estricto `> 3 × frecuencia actual`, las limitaciones de frecuencia histórica, la descripción accesible del SVG y el orden de la tabla. No cambian muestras, segmentos, cálculos de latencia, marcadores, polling, API ni worker. `PRODUCT.md`, `DESIGN.md` y los tokens permanecen intactos; el README del historial documenta la presentación actual.
- **RED observado:** las pruebas focalizadas terminaron con código 1, **5 fallos y 9 aprobadas**: instrucciones antiguas, separación de solo 3 unidades entre las bases de `ms` y el valor superior, y SVG sin franja reservada. **GREEN:** el mismo comando aprobó **14/14** pruebas (8 del componente y 6 de geometría). Las nuevas aserciones comprueban espacio interior y separación a 320, 390 y 960 unidades de ancho del gráfico, así como conservación de coordenadas y segmentos. Se mantienen las pruebas de muestras coincidentes, cero, latencia ausente y selección; se añade comprobación explícita de `ArrowLeft` junto con `ArrowRight`, `Home` y `End`.
- **Verificación completa:** `cd frontend && bun run test`: **32 archivos y 253/253 pruebas**, código 0. `bun run typecheck`, `VITE_ISOLATED_BUILD=1 bun run build`, `bun run lint` y `git diff --check`: código 0. El detector Impeccable se ejecutó una vez sobre el componente y devolvió `[]`, código 0. ASSESS indicó `reviewDue: false`, autoverificación y ningún verificador independiente requerido con RDD desactivado. No corresponde comparación diferencial de comandos CLI: no se modifican comandos, opciones, parsers ni helpers compartidos.
- **Verificación renderizada:** Chromium aislado, con fixtures exclusivamente en el navegador, a **1440, 390 y 320 px**. Evidencia final: **3 capturas anteriores y 15 posteriores**, con muestras mixtas, hueco de 420 s, valor cero, comprobación fallida con duración, latencia ausente, historial vacío y detalles cerrados/abiertos. Sin excepciones, fallos de aserciones ni desbordamiento global. La unidad queda dentro del SVG y separada de los textos numéricos por aproximadamente **8 / 7,37 / 7,79 px**. La comparación antes/después confirma marcadores medidos, segmentos y etiquetas de huecos idénticos en los tres anchos. Pasan puntero, flechas, Home/End y apertura nativa con Enter. Se inspeccionaron escritorio, móvil de 320 px, detalles abiertos a 390 px y muestras sin latencia. Se conserva el desplazamiento horizontal local del gráfico y la tabla en pantallas estrechas; no se rediseñaron esas superficies.
- **Incidencias de verificación corregidas:** la primera ejecución del script de navegador informó 8 fallos de entrada: el Enter sintetizado omitía el evento de carácter necesario para activar el `summary` nativo y algunos clics móviles caían sobre la cabecera fija después del desplazamiento provocado por el foco. El diagnóstico confirmó ambas causas en el harness; se corrigieron los eventos CDP y la posición del gráfico antes de hacer clic, sin agregar soluciones artificiales al producto. La ejecución final terminó con código 0 y cero fallos. Las capturas de detalles abiertos se normalizaron al inicio de la página para evitar el artefacto de cabecera fija en capturas completas. Evidencia y logs iniciales/finales: `.pi/stage3-verification/` (ignorados en Git).
- **Límites y riesgos pendientes:** no quedan verificaciones de esta etapa fallidas ni pendientes. Persisten los avisos existentes de Node sobre `localStorage` y del build sobre anotaciones de Zod y tamaño de chunk. No se verificaron otros motores, lectores de pantalla ni gestos táctiles en dispositivos físicos; los anchos móviles son emulados en Chromium. No se ejecutaron pruebas de API/worker ni contra producción porque no se modificaron esas superficies. El contraste de errores conocido sigue reservado a la etapa 4, sin iniciarla. **Risk: none** para esta unidad: cambio de presentación acotado, cubierto por pruebas y capturas, sin modificar helpers compartidos, contratos, seguridad, concurrencia ni entrega.
- **Unidad de commit y reversión:** componente, pruebas, README y estos resultados forman un único commit independiente con mensaje `fix(history): clarify latency chart presentation (stage 3)`. Su reversión retira solo la etapa 3. No se hace push ni se abre PR; las etapas 4–5 permanecen pendientes y sin autorización.

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

### Resultado observado de la etapa 4

- **Completada exclusivamente en `feat/sentinel-ui-hardening`**, sobre la base limpia `06bcc6e`. Se confirmó el fallo original usando el renderizado, no solo los tokens: texto `danger` `#c4746e` sobre `danger-soft` `#392523` da **4,1497:1**. Afectaba errores de login/demo, registro/demo, creación y carga inicial del dashboard; etiquetas `Unhealthy`/`Down` del dashboard, historial y estado público; y el hover de `Delete`.
- **Cambio mínimo:** esas combinaciones usan explícitamente el fondo existente `surface` `#101820`, con **5,1728:1**. Se conservan texto e iconos `danger`, bordes semánticos, etiquetas, mensajes y dimensiones. Las dos reglas heredadas de compatibilidad (`.status-badge.border-red-300` y `.pill-status.bg-red-100`) usan también `surface`. No se agrega una excepción global que cambie el significado de las utilidades `bg-danger-soft`; la selección de fondo es local y explícita. No hay nuevos colores, saturación/luminosidad aumentada ni variantes de componente.
- Los tokens canónicos, `PRODUCT.md` y `DESIGN.md` permanecen **idénticos**; sus hashes se comprobaron antes y después. No fue necesario actualizar el sistema documentado. No cambian autenticación, validación, solicitudes, polling, datos, geometría, tipografía, espaciado ni arquitectura. La comprobación estructural contra `06bcc6e` confirmó que los nueve archivos de producción contienen exclusivamente las sustituciones de fondo previstas.

| Combinación observada | Antes | Después | Decisión |
|---|---:|---:|---|
| `danger` sobre fondo de error/etiqueta/hover afectado | 4,1497:1 (`danger-soft`) | **5,1728:1** (`surface`) | Corregida; supera 4,5:1 para texto normal y 3:1 para iconos |
| Error inline `danger` sobre `surface` / `canvas` | 5,1728 / 5,6009:1 | Sin cambio | Ya cumplía; no se modifica |
| Texto informativo `muted` sobre `surface` / `raised` | 7,3641 / 6,9382:1 | Sin cambio | Se preservan jerarquía y contraste contenido |
| Placeholder `subtle` sobre `canvas` | 4,5829:1 | Sin cambio | Cumple por margen estrecho; no se aumenta luminosidad |
| `success` sobre `success-soft` | 4,8748:1 | Sin cambio | Se conserva |
| `warning` sobre `warning-soft` | 6,7522:1 | Sin cambio | Se conserva |
| Texto `canvas` del botón de confirmación sobre `danger-strong` | 4,7027:1 | Sin cambio | Se conserva |

- **Indicadores y transparencias:** el icono de caída del timeline se comprobó sobre su fondo compuesto real `#201d24` (`danger/10` sobre las capas existentes): **4,8078:1**, superior a 3:1, sin cambiarlo. Los campos inválidos de registro conservan borde `danger`: **5,6009:1** contra el relleno `canvas` y **5,1728:1** contra `surface`; el foco visible conserva el contorno opaco `accent` (6,8017:1 contra `surface`), además de sus anillos translúcidos. Los bordes suaves de las etiquetas son complementarios: la información sigue estando en texto e iconos, no depende de que ese borde decorativo alcance 3:1. Los controles deshabilitados no se contabilizan como incumplimientos de contraste exigible.
- **RED/GREEN:** antes de corregir, `cd frontend && bun run test -- src/app/styles/contrast.test.tsx src/features/monitors/MonitorsPage.test.tsx` terminó con código 1: **3 fallos previstos y 14 pruebas aprobadas**. La verificación focalizada final terminó con código 0: **10 archivos, 123/123 pruebas**; cubre login, registro, creación, eliminación, dashboard, lista, etiquetas, historial, estado público y cálculo WCAG. Se comprobaron las etiquetas del monitor y el `Down` de la tabla por separado. Las aserciones de clases protegen el uso local de los tokens; no se presentan como evidencia de colores renderizados.
- **Reproducción del cálculo:** `cd frontend && bun run test -- src/app/styles/contrast.test.tsx` verifica el fallo original y la alternativa con la fórmula WCAG de luminancia relativa sRGB (`(Lmayor + 0,05) / (Lmenor + 0,05)`), tomando los valores del CSS actual. El helper está en `src/test/contrast.ts`. Para el navegador, el script local `.pi/stage4-verification/render-check.mjs` intercepta exclusivamente fixtures sintéticos y recoge el color computado, tamaño, peso, opacidad heredada y posición del texto; captura el fondo real con los glifos ocultos, muestrea sus píxeles y compone el primer plano antes de calcular el contraste. Considera degradado del body, transparencias, cascada, hover y recorte local; excluye texto cerrado dentro de `details`. Se estabiliza el viewport completo antes de medir para no mezclar coordenadas con el redimensionamiento de una captura larga.
- **Verificación completa del frontend:** `VITE_ISOLATED_BUILD=1 bun run test`: **33 archivos, 258/258 pruebas**, código 0. `bun run typecheck`, `bun run lint`, `VITE_ISOLATED_BUILD=1 bun run build` y `git diff --check`: código 0. Detector Impeccable, una ejecución sobre los nueve archivos de producción afectados: código 0 y **`[]`**. No corresponde una comparación diferencial de comandos CLI: no se cambian comandos, opciones, parsers ni contratos.
- **Verificación renderizada y funcional:** **42 capturas anteriores y 48 posteriores**, a **1440, 390 y 320 px**. La pasada final cubre reposo, validación, errores de login/demo/registro/creación/eliminación/carga, hover, estados no saludables privados/públicos, historial y detalles abiertos; incluye además una superficie de prueba aislada para los dos selectores heredados y las referencias warning/raised. Sus **1.387 muestras de texto y 85 de indicadores** pasan los umbrales aplicables (4,5:1 normal, 3:1 grande/indicadores); mínimo de texto observado **4,5829:1**, mínimo de indicadores **4,8078:1**. Cero excepciones, aserciones fallidas o desbordamiento global. Se inspeccionaron comparaciones de error a 320 px, creación a 390 px, estado público a 1440 px e historial con detalles abiertos a 320 px: se mantienen jerarquía, sobriedad y foco visible. La ausencia de relleno rojizo no elimina la identificación textual/iconográfica de los errores.
- Se comprobaron conservación de credenciales y recuperación de controles tras error, cancelación de borrado con restauración del foco, selección del historial con Home/End y apertura nativa de detalles con Enter. La comparación de tráfico sintético observó **42 solicitudes antes y 42 después**, con métodos, rutas y cantidades agrupadas idénticas. El desplazamiento horizontal local existente de gráfico/tabla se conserva; no se inició la ergonomía móvil de la etapa 5.
- **Incidencias y desviaciones:** los primeros intentos del harness corrigieron fixtures incompletos de registro (nombre/apellido y regla del username) y el endpoint de creación de usuario (`/api/v1/users/`); la referencia final terminó con código 0, sin peticiones inesperadas. Se corrigió también el nombre del campo sintético `alert_type` para comprobar el icono real de caída, y se endurecieron las mediciones de detalles cerrados y contenido recortado. Una captura final preliminar se canceló deliberadamente antes de medir mientras se sustituía la excepción CSS contextual por utilidades locales explícitas; la pasada definitiva terminó aprobada. Son correcciones de verificación, no del producto. Sin ampliación del alcance visual ni nuevas decisiones de sistema.
- **Límites:** no quedan comprobaciones aplicables fallidas o pendientes. Persisten los avisos existentes de Node sobre `localStorage`, del build sobre anotaciones de Zod y tamaño de chunk. ASSESS no pudo formar candidato por los dos archivos de pruebas nuevos sin seguimiento; con RDD desactivado devolvió autoverificación y ningún verificador independiente, sin revisión nativa ejecutada. No se repitió ni se intentó eludir esa limitación. No se ejecutaron pruebas de API/worker, cuentas reales, producción, otros motores, lectores de pantalla ni dispositivos físicos. Esta corrección de contraste no constituye una certificación WCAG integral; el margen del placeholder sigue siendo estrecho y debe revalidarse si cambia su fondo. Evidencia local ignorada: `.pi/stage4-verification/` (scripts, logs, resultados, capturas normales y fondos muestreados).
- **Unidad de commit y reversión:** código, pruebas y estos resultados forman un único commit independiente con mensaje `fix(ui): improve error contrast with existing surfaces (stage 4)`. Su reversión retira solo los tratamientos de contraste de esta etapa y sus pruebas/documentación, sin afectar las etapas anteriores. **Risk: none**: aun revisando los estilos compartidos, el diff solo corrige las combinaciones pedidas y los dos selectores heredados equivalentes; no cambia helpers de comportamiento, contratos, seguridad, concurrencia ni entrega, y cuenta con pruebas y renderizado. No se hace push ni se abre PR; la etapa 5 permanece pendiente y sin autorización.

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
| Etapa 2 — Acceso login/demo consistente | Completada | Autorizada explícitamente por el usuario, incluido commit independiente tras verificar | RED/GREEN; focalizadas 27/27; suite 250/250; tipos, build, lint y diff-check aprobados; 18 capturas Chromium, detector `[]` y revisión independiente 5/5 sin bloqueos. Véase «Resultado observado de la etapa 2». |
| Etapa 3 — Gráfico de historial | Completada | Autorizada explícitamente por el usuario, incluido commit independiente tras verificar | RED/GREEN 14/14; suite 253/253; tipos, build, lint y diff-check aprobados; 3 capturas anteriores y 15 posteriores a 1440/390/320 px, cero fallos finales y detector `[]`. Véase «Resultado observado de la etapa 3». |
| Etapa 4 — Contraste de errores | Completada | Autorizada explícitamente por el usuario, incluido commit independiente tras verificar | Contraste 4,1497→5,1728:1; focalizadas 123/123, suite 258/258; tipos, lint, build y diff-check aprobados; 42 capturas previas y 48 finales a 1440/390/320 px, 1.472 muestras aprobadas y detector `[]`. Véase «Resultado observado de la etapa 4». |
| Etapa 5 — Optimización móvil | Pendiente | No autorizada | — |

### Registro de actualización

- Plan aprobado como base de trabajo y guardado por pedido del usuario; inicialmente la implementación de las cinco etapas permanecía sin autorizar.
- El usuario autoriza exclusivamente la etapa 1: «Implementa únicamente la etapa 1 siguiendo sus criterios de aceptación y verificaciones. No avances a las demás etapas ni hagas commits». Se contrastaron los supuestos con el código antes de implementar; `PRODUCT.md` y `DESIGN.md` permanecen intactos. Las etapas 2–5 siguen sin autorización.
- Etapa 1 cerrada tras observar la suite final 246/246 y las verificaciones registradas arriba. No se crearon commits ni se avanzó a otra etapa.
- El usuario autoriza exclusivamente la etapa 2: «Implementa únicamente la Etapa 2, respetando `PRODUCT.md` y `DESIGN.md`», en la rama actual `feat/sentinel-ui-hardening`, con pruebas, revisión visual, actualización del plan y commit independiente si todo está correcto. Prohíbe crear otra rama, hacer push, abrir PR o comenzar la etapa 3. Estado inicial limpio en `10e1fc2`; la etapa 1 ya está conservada en `b0c7b47`. Esta autorización específica de commit prevalece sobre la restricción original del plan; las etapas 3–5 siguen sin autorización.

- El usuario autoriza exclusivamente la etapa 3: «Implementa únicamente las correcciones previstas para el gráfico de latencia y la presentación del historial», «Trabaja en la rama actual `feat/sentinel-ui-hardening`, sin crear otra» y «Si todas las verificaciones pasan, crea un commit independiente para la Etapa 3». Solicita pruebas automatizadas, capturas de escritorio/móvil y actualización de este plan; prohíbe push, PR y comenzar la etapa 4. Estado inicial limpio en `15771da`. `PRODUCT.md` y `DESIGN.md` siguen siendo referencias inmutables; las etapas 4–5 permanecen sin autorización.

- El usuario autoriza exclusivamente la etapa 4: «Continuemos con la **Etapa 4 — Contraste y accesibilidad visual**», «Trabaja en la rama actual `feat/sentinel-ui-hardening`, sin crear otra» y «Crea un commit independiente para la Etapa 4» cuando todas las verificaciones estén aprobadas. Solicita contraste real renderizado, pruebas, capturas Chromium a 1440/390/320 px y preservación de la identidad visual; prohíbe push, PR y comenzar la etapa 5. Estado inicial limpio en `06bcc6e`. No se autoriza modificar los tokens canónicos, `PRODUCT.md` ni `DESIGN.md` sin explicar primero una necesidad real.

## Hechos técnicos contrastados y decisiones futuras

- En [`datetime.ts`](../../frontend/src/lib/datetime.ts), `isEngineStale` devuelve `false` si `lastCheckedAt` es `null`; de otro modo usa comparación estricta `ageSeconds > max(frequencySeconds, 30) × 2`. `parseApiDate` interpreta marcas sin zona como UTC.
- [`MonitorRow`](../../frontend/src/features/monitors/MonitorRow.tsx) recibe `now` como prop; [`MonitorList`](../../frontend/src/features/monitors/MonitorList.tsx) le pasa `new Date()` como valor predeterminado durante render. [`useMonitors`](../../frontend/src/features/monitors/useMonitors.ts) usa `VITE_POLL_INTERVAL_MS` o 10 000 ms por defecto y 30 000 ms de backoff de error. [`useMonitorHistory`](../../frontend/src/features/monitors/history/useMonitorHistory.ts) define `REFRESH_MS = 30_000` y considera errores terminales/cooldown en su política de polling.
- Una respuesta idéntica no garantiza un nuevo render que reevalúe el tiempo. En la etapa 1 se implementó [`useMonitorFreshness`](../../frontend/src/features/monitors/useMonitorFreshness.ts), utilizado por cada fila y por el historial: programa el próximo vencimiento futuro + 1 ms o una actualización local cada 30 s y limpia el timer. No hay reloj global de un segundo ni tráfico adicional a la API. Los resultados ya vencidos, las pausas y las fechas inválidas no crean un bucle de timers.
- En `LatencyChart.tsx`, la selección existente contempla puntero y teclado (`ArrowLeft`, `ArrowRight`, `Home`, `End`). [`buildLatencyChartGeometry`](../../frontend/src/features/monitors/history/chart-geometry.ts) usa `timestamp delta > 3 × frecuencia actual` para los huecos; esto es una heurística distinta del umbral de frescura. No se propone cambiarla.
- La etapa 4 no cambiará el token global de peligro mientras la documentación de diseño deba seguir intacta; se priorizan combinaciones locales con la paleta existente. Si no bastan, se presenta la limitación antes de ampliar alcance.
- La etapa 2 reemplazó los estados independientes de login por `activeOperation` y `busyRef`: ambas alternativas se deshabilitan durante la solicitud y solo la operación activa cambia su texto. La guarda del login se evalúa después de validar el formulario; demo adquiere el bloqueo síncronamente en su handler. [`RegisterPage.tsx`](../../frontend/src/features/register/RegisterPage.tsx) conserva su coordinación existente sin modificaciones.

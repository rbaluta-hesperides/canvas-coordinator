# Campus Coordinator

Una aplicación local que conecta con Canvas y prepara correos de coordinación académica por curso universitario, con sus asignaturas, estudiantes, clases y entregas. Las plantillas y los borradores se guardan en tu ordenador.

## Ejecutar

Necesitas Node.js 22.12 o posterior y npm. En PowerShell, desde la carpeta del proyecto:

```powershell
npm.cmd install
npm.cmd start
```

También puedes usar `ABRIR.bat` para iniciar la aplicación en Windows.

Para abrir la vista previa local en el navegador:

```powershell
npm.cmd run preview
```

La vista previa se sirve en `http://127.0.0.1:4173`; sus datos están separados de los de la aplicación de escritorio. Para conectar una cuenta real de Canvas o seleccionar una carpeta local de CanvasManager, usa la aplicación de escritorio.

Para ejecutar las pruebas:

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:electron
```

## Flujo de trabajo

1. Pulsa **Conectar Canvas**, comprueba el dominio de tu universidad e inicia sesión en la ventana que se abre. Se usa tu cuenta de coordinación y el acceso institucional habitual.
2. La aplicación descarga automáticamente tus asignaturas, módulos, estudiantes activos, profesorado, calendario y actividades con fecha de entrega. Agrupa las asignaturas por titulación y curso cuando Canvas proporciona esos datos. No necesitas exportar una caché ni preparar un CSV.
3. Elige el curso destinatario, por ejemplo **3º de Grado en Economía**, y la **Semana**. Verás directamente el correo completo con las actividades de todas sus asignaturas, sus días, horarios y material que preparar. El resumen semanal es el flujo inicial.
4. Revisa el borrador. **Personalizar borrador** permite ajustar el texto, las actividades y los avisos cuando haga falta; estos detalles son opcionales. El día, el mes y el año siguen disponibles por separado para tus plantillas. **Correo de una clase** permite preparar un mensaje individual.
5. Selecciona todos los estudiantes con correo disponible o únicamente las personas que deban recibir el mensaje. Revisa tu dirección y firma en los ajustes.
6. Abre Gmail para revisar el correo. La dirección de coordinación figura en «Para» y los estudiantes seleccionados en «CCO». Tú realizas el envío desde Gmail.

Las plantillas emplean variables como `{{course_name}}`, `{{subject}}`, `{{day}}`, `{{month}}`, `{{year}}`, `{{session_name}}` y `{{preparation}}`. Puedes colocar cada parte de la fecha de forma independiente. Las variables pendientes impiden abrir un mensaje incompleto.

`{{course_name}}` es el curso universitario destinatario, como «3º de Grado en Economía»; `{{subject}}` es una asignatura concreta, como «Econometría I».

En **Ajustes → Apariencia** puedes elegir **Claro**, **Oscuro** o **Sistema**. El botón de luna o sol de la barra superior permite cambiar rápidamente de modo. La preferencia se guarda en este equipo y se recupera al volver a abrir la aplicación.

## Cursos y asignaturas

La jerarquía es **curso universitario → asignaturas → actividades del calendario**. El objeto que la API de Canvas llama `course` corresponde aquí a una asignatura; no se utiliza su nombre como si fuera el curso universitario completo.

La agrupación automática reconoce los códigos académicos que utiliza CanvasManager: por ejemplo, `Econometría I [G.EC|26/27|S5|2]` identifica una asignatura de Economía, del periodo académico **2026/27**, y del semestre **5**, que corresponde a **tercero**. Los semestres 5 y 6 pertenecen a tercero. El periodo académico y el año de la titulación son datos distintos. Una asignatura marcada `S3-S5` se incluye tanto en segundo como en tercero, sin mezclar sus destinatarios. La agrupación mantiene separadas las cuentas de Canvas y los periodos académicos.

La coincidencia de estudiantes entre asignaturas no se utiliza para deducir el curso. Cuando faltan los metadatos, las asignaturas siguen disponibles sin un curso identificado; no se inventa una titulación ni un año. Los códigos de titulaciones cuyo nombre no se reconoce se conservan tal como aparecen en Canvas.

## Conexión con Canvas

El acceso principal es el inicio de sesión de Canvas en una ventana aislada de la aplicación. La dirección predeterminada es `https://hesperides.instructure.com`; puedes indicar otro dominio HTTPS de Canvas. Si el proveedor de tu universidad bloquea el acceso desde esa ventana, despliega **Acceso alternativo con token** e introduce un token personal autorizado para tu cuenta.

La sincronización se realiza al conectar, al volver a abrir la aplicación y cada 15 minutos mientras permanece abierta, cuando no estás editando un campo ni usando un diálogo. **Actualizar** permite solicitar una lectura inmediata. Los datos descargados permanecen disponibles localmente cuando no hay conexión. Desconectar elimina el acceso guardado a Canvas en esta aplicación; las copias locales de los cursos y los borradores siguen disponibles.

La aplicación solo puede leer los cursos y datos que permite tu cuenta. La lista de estudiantes activos se actualiza desde Canvas, incluidas las bajas. Si Canvas deniega una parte de la sincronización, se muestra un aviso y se conserva la última información disponible para esa parte. Una lista de estudiantes que no se pudo consultar no se interpreta como un curso vacío. Canvas puede ocultar el correo de algunos estudiantes: la aplicación indica cuántos faltan y no inventa direcciones. Para disponer de la lista completa, la cuenta debe tener los permisos correspondientes en Canvas.

## Resumen semanal

El modo **Resumen semanal** reúne clases, tutorías, exámenes y entregas de las asignaturas de un curso en un solo correo. El asunto usa el intervalo de días y el nombre del curso: `Semana del 5 al 11 | 3º de Grado en Economía`. La semana abarca de **lunes a domingo**, de modo que también incluye convocatorias de examen y entregas del fin de semana. Si Canvas publica varias alternativas de una actividad, se conservan como apartados distintos.

1. Selecciona el curso y la semana. Se propone la próxima semana y se incluyen todas las asignaturas del curso. Puedes escribir una semana concreta o usar los botones de semana anterior y siguiente; la aplicación consulta su calendario automáticamente.
2. El correo aparece ya generado y organizado por días. Cada fecha figura una sola vez como encabezado, por ejemplo **Lunes, 5 de octubre de 2026**; debajo aparecen las actividades de ese día ordenadas por hora. Cada viñeta muestra el horario de inicio y fin, la asignatura y la actividad, seguida del material que preparar cuando lo hay. Una asignatura con varias clases aparece varias veces, dentro de los días correspondientes. Las clases se vinculan con su módulo cuando el título, número o fecha permiten identificarlas sin ambigüedad; su preparación procede de las sesiones y materiales anteriores en el orden de Canvas. Para un examen identificado en la estructura de Canvas, el punto de preparación es la última sesión asincrónica anterior al examen. Las sesiones posteriores al examen quedan fuera.
3. Comprueba el mensaje y los destinatarios y abre Gmail con coordinación en «Para» y la selección en «CCO». Las opciones para cambiar el saludo, la introducción, la despedida, las actividades o los avisos están en **Personalizar borrador**. **Ajustar periodo o asignaturas** permite excepciones al periodo y a la agenda predeterminados.

Elegir otra semana inicia un correo nuevo para ese periodo: se regeneran las actividades y el texto del mensaje, sin sobrescribir los borradores guardados de otras semanas. Se conservan el saludo, la introducción, la despedida y la selección de destinatarios. **Actualizar desde Canvas** dentro de la misma semana conserva tus ajustes y actualiza el horario de las actividades, aunque hayas editado su preparación. Las actividades de Canvas mantienen el orden cronológico. Si añades apartados manuales sin fecha a una agenda con actividades fechadas, se reúnen al final en **Otros avisos**, respetando el orden en que los has colocado. Un mensaje formado únicamente por apartados sin fecha conserva su lista original.

Puedes añadir actividades manuales cuando necesites comunicar algo que no figure en Canvas. Las fechas y el intervalo horario proceden del calendario de Canvas y se muestran en la zona horaria elegida en los ajustes. Una actividad de día completo se identifica como tal; si Canvas no publica una hora, no se inventa. Cambiar el módulo de preparación no sustituye el horario de una actividad publicada en el calendario.

Si una actividad no tiene preparación, el correo muestra su nombre y horario y omite ese apartado. No añade frases como «No hay sesiones adicionales», campos pendientes ni instrucciones genéricas de relleno. Dejar la preparación vacía no impide abrir el correo en Gmail. El texto de las actividades omite direcciones web y enlaces a Canvas, vídeos y otros recursos, incluidas las direcciones presentes en notas de actividades guardadas anteriormente. El texto completo que escribas en **Editar texto**, las plantillas y el saludo se conservan como los hayas definido.

Los destinatarios del curso se reúnen a partir de las matrículas de sus asignaturas exclusivas de ese año, sin repetir estudiantes ni direcciones. Las asignaturas compartidas con otros años se incluyen en la agenda, pero sus matrículas no añaden automáticamente estudiantes de otro curso. Si solo existen asignaturas compartidas, la aplicación muestra que no puede identificar los destinatarios de ese curso con esos datos. La lista permite revisar o reducir la selección. Cambiar las asignaturas incluidas en el resumen no amplía la lista de destinatarios del curso seleccionado.

Si una entrega tiene fechas distintas por sección, grupo o estudiante, se indican como fechas específicas publicadas en Canvas. Las excepciones individuales no revelan nombres de estudiantes en el correo. Cuando Canvas no facilita esas fechas completas, se muestra un aviso y no se presenta una fecha general como válida para todo el curso.

La plantilla genérica **Resumen semanal** se añade una sola vez a los espacios de trabajo existentes, conservando las plantillas editadas y los borradores. Puedes modificarla o eliminarla después. El correo se abre en Gmail como texto con viñetas; configura tu propia firma. La plantilla no incluye logotipos, direcciones de estudiantes ni políticas institucionales del correo de ejemplo.

## Datos locales y privacidad

La aplicación contacta con Canvas y con el proveedor de acceso de tu universidad para iniciar sesión y leer los datos autorizados. La sincronización no modifica cursos, estudiantes, calificaciones ni actividades. La lectura de páginas usa el listado de páginas o su última revisión, siguiendo CanvasManager, para no marcar las lecciones como vistas.

Los datos de los cursos, estudiantes, plantillas y borradores permanecen en este equipo. No hay servidor propio, alojamiento público de datos ni analítica. En escritorio se guardan en `workspace.json` dentro de la carpeta de datos de Electron (`app.getPath('userData')`); también se conserva una copia local `.bak`. La vista previa usa `.preview-data/workspace.json` dentro del proyecto. Estos archivos de trabajo no están cifrados; dependen de los permisos de tu cuenta y del disco. Las copias de seguridad contienen los datos de los estudiantes: guárdalas en una ubicación privada.

La configuración de conexión se guarda por separado en `canvas-connection.json`. Cuando el sistema ofrece almacenamiento seguro, Electron `safeStorage` cifra el token o la copia de las cookies de Canvas con la protección del sistema operativo. Si ese cifrado no está disponible, el token permanece únicamente en memoria y hay que volver a introducirlo al reiniciar. El inicio de sesión utiliza un perfil de navegador separado, con su propio almacenamiento de cookies. Las credenciales no se incorporan a los cursos, las plantillas ni los borradores.

La opción de Gmail abre una ventana de redacción mediante una URL. No envía el correo automáticamente ni garantiza que Gmail lo haya guardado como borrador mediante una API. Gmail recibe el contenido y las direcciones al abrir esa opción; revísalos antes de enviar. Los límites prácticos de longitud de las URL pueden afectar a mensajes extensos o listas grandes: utiliza la opción de copiar y pegar cuando corresponda.

## Importación local opcional

Como alternativa a la conexión directa, puedes importar archivos existentes de CanvasManager. Su caché suele estar en `%APPDATA%\Canvas Manager\cache\canvas` o `%APPDATA%\canvas-manager\cache\canvas`. Una carpeta compatible contiene `courses.json` y archivos `content-{id}.json` para los cursos. Los contenidos importados deben corresponder al mismo usuario de la caché. Esta importación lee únicamente datos locales, sin copiar las credenciales de CanvasManager.

Puedes importar estudiantes desde un CSV con columnas `id`, `name` y `email`; también se admiten los encabezados en español. Por ejemplo:

```csv
id,name,email
estudiante-1,Alba Navarro,alba@example.com
estudiante-2,Bruno López,bruno@example.com
```

También puedes importar asignaturas en JSON con sus campos `id`, `name`, `code`, `subject`, `students` y `modules`. La pertenencia a un curso se obtiene de los códigos de Canvas o de `academicMemberships`, cuyos elementos incluyen `degreeCode`, `degree`, `academicPeriod` y `studyYear`. Los módulos usan `id`, `name`, `position` e `items`; sus elementos usan `id`, `title`, `type` y `position`. Se aceptan tanto estructuras compatibles con Canvas como los sobres de caché de CanvasManager.

Los cursos de demostración están identificados como tales y todos sus correos usan `example.com`.

## Relación con CanvasManager

La conexión y lectura de contenidos toma como referencia los servicios de CanvasManager en `app/main/services/canvas/`. La interpretación de los módulos sigue sus convenciones de clases y materiales.

Los módulos y sus elementos se ordenan por `position`. Una «Sesión N» habitual corresponde a material asincrónico; una «Clase sincrónica N» o una «Sesión sincrónica N» identifica la clase en directo. También se reconocen los módulos marcados con `⚪` y «Sesión N», o con elementos «Antes/Después de la clase N». La sugerencia indica la última sesión y el último material previos a la clase elegida, con los contenidos acumulados hasta ese punto. Se excluyen las clases sincrónicas anteriores y los elementos administrativos, de debate o de grabaciones. Los recursos generales fuera de una sesión no cambian el punto de preparación. Cuando no existen módulos identificados como sesiones, solo se propone una preparación si hay evidencia explícita de vídeos; la interfaz indica que esa sugerencia necesita revisión.

Los exámenes se relacionan con su punto en la estructura de la asignatura. Por ejemplo, si Canvas ordena «Sesión 14», «Examen final» y «Sesión 15», el examen toma como límite la sesión 14. La relación debe ser identificable en los datos; un examen sin correspondencia suficiente no recibe la preparación de una clase cualquiera.

Las fechas y horas proceden del calendario de Canvas. Al trabajar con importaciones o una copia cuyo calendario no se ha podido actualizar, también pueden leerse fechas explícitas de los títulos de los módulos, por ejemplo `Después de la clase 2 [27/10/2026]`. Un calendario actualizado tiene prioridad sobre esas fechas, para que una clase reprogramada no vuelva a aparecer con su horario antiguo. Cuando no hay preparación disponible, se mantiene la actividad con su horario y se omite la preparación. La aplicación no deduce qué ha visto cada estudiante y presenta la preparación disponible como una sugerencia que debe revisar coordinación.

## Validación

Las pruebas cubren la conexión a Canvas con respuestas simuladas, la paginación, la protección de credenciales, los permisos parciales, la actualización de estudiantes, las fechas y horas del calendario y la generación del resumen semanal. Incluyen semanas de lunes a domingo, límites de año y semana 53, años bisiestos, cambios de hora y actividades de fin de semana. También cubren la distinción entre cursos y asignaturas, las asignaturas compartidas entre años, la separación de periodos y cuentas, la unión de destinatarios, la derivación de clases y preparación, los límites de preparación de exámenes, la omisión de preparación vacía y enlaces accesorios, la sustitución de variables, la construcción del enlace de Gmail, la recuperación de archivos locales y los flujos de interfaz. Los borradores guardados conservan el texto de su plantilla aunque luego se edite la biblioteca.

Las pruebas de navegador usan Microsoft Edge en Windows si está instalado; puedes indicar otro Chromium con `PLAYWRIGHT_EXECUTABLE_PATH`. Usan una carpeta de datos independiente y bloquean toda navegación externa. Las pruebas de escritorio usan un perfil temporal y sustituyen la apertura del navegador. No necesitan una cuenta de Canvas o de Gmail y no envían mensajes.

La aplicación usa aislamiento de contexto y una interfaz de permisos limitada siguiendo las [recomendaciones de seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security). La redacción utiliza [CCO de Gmail](https://support.google.com/mail/answer/2819488?hl=es) para mantener ocultas las direcciones entre estudiantes.

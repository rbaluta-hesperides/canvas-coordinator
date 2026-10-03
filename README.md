# Campus Coordinator

Una aplicación local que conecta con Canvas y prepara correos de coordinación académica a partir de sus cursos, estudiantes, clases y entregas. Las plantillas y los borradores se guardan en tu ordenador.

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
2. La aplicación descarga automáticamente tus cursos, módulos, estudiantes activos, profesorado, calendario y actividades con fecha de entrega. No necesitas exportar una caché ni preparar un CSV.
3. Elige el curso destinatario y **Resumen semanal**, o una plantilla para una clase individual. Revisa las actividades, fechas y preparación obtenidas de Canvas.
4. Ajusta el texto si hace falta. El día, el mes y el año siguen disponibles por separado para colocarlos de forma independiente en tus plantillas.
5. Selecciona todos los estudiantes con correo disponible o únicamente las personas que deban recibir el mensaje. Revisa tu dirección y firma en los ajustes.
6. Abre Gmail para revisar el correo. La dirección de coordinación figura en «Para» y los estudiantes seleccionados en «CCO». Tú realizas el envío desde Gmail.

Las plantillas emplean variables como `{{course_name}}`, `{{subject}}`, `{{day}}`, `{{month}}`, `{{year}}`, `{{session_name}}` y `{{preparation}}`. Puedes colocar cada parte de la fecha de forma independiente. Las variables pendientes impiden abrir un mensaje incompleto.

En **Ajustes → Apariencia** puedes elegir **Claro**, **Oscuro** o **Sistema**. El botón de luna o sol de la barra superior permite cambiar rápidamente de modo. La preferencia se guarda en este equipo y se recupera al volver a abrir la aplicación.

## Conexión con Canvas

El acceso principal es el inicio de sesión de Canvas en una ventana aislada de la aplicación. La dirección predeterminada es `https://hesperides.instructure.com`; puedes indicar otro dominio HTTPS de Canvas. Si el proveedor de tu universidad bloquea el acceso desde esa ventana, despliega **Acceso alternativo con token** e introduce un token personal autorizado para tu cuenta.

La sincronización se realiza al conectar, al volver a abrir la aplicación y cada 15 minutos mientras permanece abierta, cuando no estás editando un campo ni usando un diálogo. **Actualizar** permite solicitar una lectura inmediata. Los datos descargados permanecen disponibles localmente cuando no hay conexión. Desconectar elimina el acceso guardado a Canvas en esta aplicación; las copias locales de los cursos y los borradores siguen disponibles.

La aplicación solo puede leer los cursos y datos que permite tu cuenta. La lista de estudiantes activos se actualiza desde Canvas, incluidas las bajas. Si Canvas deniega una parte de la sincronización, se muestra un aviso y se conserva la última información disponible para esa parte. Una lista de estudiantes que no se pudo consultar no se interpreta como un curso vacío. Canvas puede ocultar el correo de algunos estudiantes: la aplicación indica cuántos faltan y no inventa direcciones. Para disponer de la lista completa, la cuenta debe tener los permisos correspondientes en Canvas.

## Resumen semanal

El modo **Resumen semanal** reúne clases, tutorías, exámenes y otros avisos en un solo correo. El asunto usa el intervalo de días y el nombre del curso o grupo: `Semana del 5 al 9 | Nombre del curso`. El modo de preparación de una clase individual sigue disponible.

1. Selecciona arriba el curso o grupo destinatario y activa **Resumen semanal**. Para los cursos conectados, la aplicación propone la próxima semana; puedes cambiar el periodo y las asignaturas incluidas. Los campos de la fecha del correo se pueden seguir editando por separado.
2. El calendario y las actividades de Canvas generan los apartados del correo con las fechas, horas, instrucciones publicadas y entregas. Las clases se vinculan con su módulo cuando el título, número o fecha permiten identificarlas sin ambigüedad. La preparación procede de las sesiones y materiales anteriores a esa clase en el orden de Canvas. Revisa los avisos cuando Canvas no publique preparación suficiente; el temario de un examen no se deduce de otras clases.
3. Edita el saludo, la introducción y la despedida, añade avisos generales si hacen falta y revisa la vista previa. Selecciona los estudiantes destinatarios y abre Gmail con coordinación en «Para» y la selección en «CCO».

Puedes añadir actividades manuales cuando necesites comunicar algo que no figure en Canvas. Las fechas con hora se muestran en la zona horaria elegida en los ajustes. La lista de destinatarios procede únicamente del curso o grupo seleccionado arriba: incluir otra asignatura en el resumen no añade sus estudiantes al mensaje.

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

También puedes importar cursos en JSON con sus campos `id`, `name`, `code`, `subject`, `students` y `modules`. Los módulos usan `id`, `name`, `position` e `items`; sus elementos usan `id`, `title`, `type` y `position`. Se aceptan tanto estructuras compatibles con Canvas como los sobres de caché de CanvasManager.

Los cursos de demostración están identificados como tales y todos sus correos usan `example.com`.

## Relación con CanvasManager

La conexión y lectura de contenidos toma como referencia los servicios de CanvasManager en `app/main/services/canvas/`. La interpretación de los módulos sigue sus convenciones de clases y materiales.

Los módulos y sus elementos se ordenan por `position`. Una «Sesión N» habitual corresponde a material asincrónico; una «Clase sincrónica N» o una «Sesión sincrónica N» identifica la clase en directo. También se reconocen los módulos marcados con `⚪` y «Sesión N», o con elementos «Antes/Después de la clase N». La sugerencia indica la última sesión y el último material previos a la clase elegida, con los contenidos acumulados hasta ese punto. Se excluyen las clases sincrónicas anteriores y los elementos administrativos, de debate o de grabaciones. Los recursos generales fuera de una sesión no cambian el punto de preparación. Cuando no existen módulos identificados como sesiones, solo se propone una preparación si hay evidencia explícita de vídeos; la interfaz indica que esa sugerencia necesita revisión.

Las fechas proceden del calendario de Canvas y también pueden leerse de los títulos de sus módulos, por ejemplo `Después de la clase 2 [27/10/2026]`. Si Canvas no permite identificar una clase o no publica su preparación, se indica para revisión. La aplicación no deduce qué ha visto cada estudiante y presenta la preparación como una sugerencia que debe revisar coordinación.

## Validación

Las pruebas cubren la conexión a Canvas con respuestas simuladas, la paginación, la protección de credenciales, los permisos parciales, la actualización de estudiantes, las fechas del calendario y la generación del resumen semanal. También cubren la derivación de clases y preparación, la sustitución de variables, la construcción del enlace de Gmail, la recuperación de archivos locales y los flujos de interfaz. Los borradores guardados conservan el texto de su plantilla aunque luego se edite la biblioteca.

Las pruebas de navegador usan Microsoft Edge en Windows si está instalado; puedes indicar otro Chromium con `PLAYWRIGHT_EXECUTABLE_PATH`. Usan una carpeta de datos independiente y bloquean toda navegación externa. Las pruebas de escritorio usan un perfil temporal y sustituyen la apertura del navegador. No necesitan una cuenta de Canvas o de Gmail y no envían mensajes.

La aplicación usa aislamiento de contexto y una interfaz de permisos limitada siguiendo las [recomendaciones de seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security). La redacción utiliza [CCO de Gmail](https://support.google.com/mail/answer/2819488?hl=es) para mantener ocultas las direcciones entre estudiantes.

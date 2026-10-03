# Campus Coordinator

Una aplicación local para preparar correos de coordinación académica a partir de plantillas, la estructura de los cursos de Canvas y una selección de estudiantes.

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

La vista previa se sirve en `http://127.0.0.1:4173`; sus datos están separados de los de la aplicación de escritorio. La selección nativa de una carpeta de CanvasManager está disponible en la aplicación de escritorio.

Para ejecutar las pruebas:

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:electron
```

## Flujo de trabajo

1. Importa cursos y contenidos desde una copia local de CanvasManager, o carga los cursos de demostración. Los cursos de demostración están identificados como tales y todos sus correos usan `example.com`.
2. Revisa el nombre del curso y la asignatura, y añade o importa la lista de estudiantes.
3. Elige una plantilla y la clase sincrónica que quieres preparar.
4. Completa el día, el mes y el año por separado. Revisa la preparación sugerida y el texto final.
5. Selecciona todos los estudiantes o únicamente las personas que deban recibir el mensaje.
6. Abre Gmail para revisar el correo. La dirección de coordinación figura en «Para» y los estudiantes seleccionados en «CCO».

Las plantillas emplean variables como `{{course_name}}`, `{{subject}}`, `{{day}}`, `{{month}}`, `{{year}}`, `{{session_name}}` y `{{preparation}}`. Puedes colocar cada parte de la fecha de forma independiente. Las variables pendientes impiden abrir un mensaje incompleto.

## Resumen semanal

El modo **Resumen semanal** reúne clases, tutorías, exámenes y otros avisos en un solo correo. El asunto usa el intervalo de días y el nombre del curso o grupo: `Semana del 5 al 9 | Nombre del curso`. El modo de preparación de una clase individual sigue disponible.

1. Selecciona arriba el curso o grupo destinatario, activa **Resumen semanal** y completa los días de inicio y fin. Los campos de fecha se editan por separado; el mes y el año son opcionales.
2. Añade una entrada por actividad con su asignatura y el nombre de la clase, tutoría o examen; puedes incluir el nombre del docente. Cada entrada puede tomar de forma independiente una clase y su preparación de un curso de Canvas, o completarse manualmente. Para un examen, escribe el contenido que entra; si una actividad no requiere preparación, indícalo expresamente. Usa las notas adicionales para fechas, horas, entregas y otros recordatorios.
3. Edita el saludo, la introducción y la despedida, añade avisos generales si hacen falta y revisa la vista previa. Selecciona los estudiantes destinatarios y abre Gmail con coordinación en «Para» y la selección en «CCO».

La lista de destinatarios procede únicamente del curso o grupo seleccionado arriba. Elegir otro curso de Canvas dentro de una actividad sirve para consultar su contenido; no incorpora sus estudiantes al mensaje.

La plantilla genérica **Resumen semanal** se añade una sola vez a los espacios de trabajo existentes, conservando las plantillas editadas y los borradores. Puedes modificarla o eliminarla después. El correo se abre en Gmail como texto con viñetas; configura tu propia firma. La plantilla no incluye logotipos, direcciones de estudiantes ni políticas institucionales del correo de ejemplo.

## Importación y privacidad

No se conecta con Canvas: trabaja con archivos que tú eliges. CanvasManager guarda normalmente su caché en `%APPDATA%\Canvas Manager\cache\canvas` o `%APPDATA%\canvas-manager\cache\canvas`. Una carpeta compatible contiene `courses.json` y archivos `content-{id}.json` para los cursos. Los contenidos importados deben corresponder al mismo usuario de la caché. La importación no lee credenciales ni necesita un token de Canvas.

Puedes importar estudiantes desde un CSV con columnas `id`, `name` y `email`; también se admiten los encabezados en español. Por ejemplo:

```csv
id,name,email
estudiante-1,Alba Navarro,alba@example.com
estudiante-2,Bruno López,bruno@example.com
```

También puedes importar cursos en JSON con sus campos `id`, `name`, `code`, `subject`, `students` y `modules`. Los módulos usan `id`, `name`, `position` e `items`; sus elementos usan `id`, `title`, `type` y `position`. Se aceptan tanto estructuras compatibles con Canvas como los sobres de caché de CanvasManager.

Los datos y las plantillas permanecen en este equipo. No hay servidor remoto, alojamiento público, analítica ni sincronización automática. En escritorio se guardan en `workspace.json` dentro de la carpeta de datos de Electron (`app.getPath('userData')`); también se conserva una copia local `.bak`. La vista previa usa `.preview-data/workspace.json` dentro del proyecto. Estos archivos no están cifrados; dependen de los permisos de tu cuenta y del disco. Las copias de seguridad contienen los datos de los estudiantes: guárdalas en una ubicación privada.

La opción de Gmail abre una ventana de redacción mediante una URL. No envía el correo automáticamente ni garantiza que Gmail lo haya guardado como borrador mediante una API. Gmail recibe el contenido y las direcciones al abrir esa opción; revísalos antes de enviar. Los límites prácticos de longitud de las URL pueden afectar a mensajes extensos o listas grandes: utiliza la opción de copiar y pegar cuando corresponda.

## Relación con CanvasManager

La interpretación de los módulos toma como referencia CanvasManager, en especial `app/main/services/canvas/classprep.js` y `app/main/services/study/materials.js` de ese proyecto.

Los módulos y sus elementos se ordenan por `position`. Una «Sesión N» habitual corresponde a material asincrónico; una «Clase sincrónica N» o una «Sesión sincrónica N» identifica la clase en directo. También se reconocen los módulos marcados con `⚪` y «Sesión N», o con elementos «Antes/Después de la clase N». La sugerencia indica la última sesión y el último material previos a la clase elegida, con los contenidos acumulados hasta ese punto. Se excluyen las clases sincrónicas anteriores y los elementos administrativos, de debate o de grabaciones. Los recursos generales fuera de una sesión no cambian el punto de preparación. Cuando no existen módulos identificados como sesiones, solo se propone una preparación si hay evidencia explícita de vídeos; la interfaz indica que esa sugerencia necesita revisión.

Las fechas pueden leerse de los títulos de Canvas, por ejemplo `Después de la clase 2 [27/10/2026]`. Si faltan la fecha, la hora o la preparación, se dejan vacías para completarlas. La aplicación no deduce qué ha visto cada estudiante y presenta la preparación como una sugerencia que debe revisar coordinación.

## Validación

Las pruebas cubren las transformaciones de datos, la derivación de clases y preparación, la sustitución de variables, la construcción del enlace de Gmail, la recuperación de archivos locales y los flujos de interfaz. Los borradores guardados conservan el texto de su plantilla aunque luego se edite la biblioteca. Las importaciones actualizan los detalles automáticos y conservan las correcciones manuales.

Las pruebas de navegador usan Microsoft Edge en Windows si está instalado; puedes indicar otro Chromium con `PLAYWRIGHT_EXECUTABLE_PATH`. Usan una carpeta de datos independiente y bloquean toda navegación externa. Las pruebas de escritorio usan un perfil temporal y sustituyen la apertura del navegador. No necesitan una cuenta de Canvas o de Gmail y no envían mensajes.

La aplicación usa aislamiento de contexto y una interfaz de permisos limitada siguiendo las [recomendaciones de seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security). La redacción utiliza [CCO de Gmail](https://support.google.com/mail/answer/2819488?hl=es) para mantener ocultas las direcciones entre estudiantes.

export const VARIABLES = [
  { key: 'course_name', label: 'Nombre del curso', example: 'Grado en Filosofía · 2.º A' },
  { key: 'subject', label: 'Asignatura', example: 'Ética' },
  { key: 'day', label: 'Día', example: '13' },
  { key: 'month', label: 'Mes', example: 'octubre' },
  { key: 'year', label: 'Año', example: '2026' },
  { key: 'time', label: 'Hora', example: '18:00' },
  { key: 'end_time', label: 'Hora de fin', example: '19:00' },
  { key: 'session_name', label: 'Clase sincrónica', example: 'Clase sincrónica 1' },
  { key: 'preparation', label: 'Preparación previa', example: 'Hasta la sesión 2: El juicio moral.' },
  { key: 'coordinator_name', label: 'Nombre de coordinación', example: 'Alex García' },
  { key: 'signature', label: 'Firma', example: 'Coordinación académica' },
  { key: 'extra_notes', label: 'Notas adicionales', example: 'Traed vuestras preguntas para el debate.' },
  { key: 'meeting_link', label: 'Enlace de la clase', example: 'https://example.com/aula' },
  { key: 'week_start_day', label: 'Primer día de la semana', example: '5' },
  { key: 'week_end_day', label: 'Último día de la semana', example: '9' },
  { key: 'greeting', label: 'Saludo', example: 'Queridos alumnos:' },
  { key: 'weekly_intro', label: 'Introducción del resumen semanal', example: 'Os compartimos las actividades previstas para esta semana.' },
  { key: 'weekly_agenda', label: 'Agenda semanal', example: 'Lunes 5\n18:00 · Clase de la asignatura\nPreparación: hasta la sesión 2.' },
  { key: 'general_notices', label: 'Avisos generales', example: 'Consultad en Canvas las novedades de las asignaturas.' },
  { key: 'closing', label: 'Despedida', example: 'Que tengáis una buena semana.\nUn saludo,' },
];

const TEMPLATE_DATE = '2026-10-03T00:00:00.000Z';
const CATALOG_VERSION = 1;

export function weeklyTemplate() {
  return {
    id: 'template-weekly-summary',
    kind: 'weekly',
    name: 'Resumen semanal',
    description: 'Clases, tutorías, exámenes y avisos para todo el curso.',
    category: 'Planificación semanal',
    subject: 'Semana del {{week_start_day}} al {{week_end_day}} | {{course_name}}',
    body: '{{greeting}}\n\n{{weekly_intro}}\n\n{{weekly_agenda}}\n\n{{general_notices}}\n\n{{closing}}\n\n{{coordinator_name}}\n{{signature}}',
    updatedAt: TEMPLATE_DATE,
  };
}

export function upgradeWorkspace(state) {
  if (Number(state.catalogVersion) >= CATALOG_VERSION) return { state, changed: false };
  const templates = Array.isArray(state.templates) ? state.templates : [];
  return {
    state: {
      ...state,
      catalogVersion: CATALOG_VERSION,
      templates: templates.some((template) => template.id === 'template-weekly-summary')
        ? templates
        : [...templates, weeklyTemplate()],
    },
    changed: true,
  };
}

function initialTemplates() {
  return [
    {
      id: 'template-reminder',
      name: 'Recordatorio de clase',
      description: 'Fecha, hora y preparación para la próxima clase sincrónica.',
      category: 'Recordatorio',
      subject: '{{subject}} · Clase del {{day}} de {{month}} de {{year}}',
      body: 'Hola a todos:\n\nOs recordamos que la próxima clase de {{subject}}, del curso {{course_name}}, tendrá lugar el {{day}} de {{month}} de {{year}} a las {{time}}.\n\nSesión: {{session_name}}\n\nAntes de la clase, revisad el siguiente contenido en Canvas:\n{{preparation}}\n\nUn saludo,\n{{coordinator_name}}\n{{signature}}',
      updatedAt: TEMPLATE_DATE,
    },
    {
      id: 'template-preparation',
      name: 'Material antes de clase',
      description: 'Indica hasta dónde avanzar en Canvas antes de la sesión.',
      category: 'Preparación',
      subject: '{{subject}} · Preparación para {{session_name}}',
      body: 'Hola a todos:\n\nPara preparar {{session_name}} de {{subject}}, prevista para el {{day}} de {{month}}, os pedimos revisar este contenido:\n\n{{preparation}}\n\nPodéis encontrar los materiales en los módulos de Canvas de {{course_name}}. Anotad las dudas que os surjan para comentarlas durante la clase.\n\nUn saludo,\n{{coordinator_name}}\n{{signature}}',
      updatedAt: TEMPLATE_DATE,
    },
    {
      id: 'template-schedule-change',
      name: 'Cambio de fecha u horario',
      description: 'Comunica la nueva fecha de una clase y añade el motivo o indicaciones.',
      category: 'Aviso',
      subject: '{{subject}} · Cambio de horario de {{session_name}}',
      body: 'Hola a todos:\n\nOs informamos de un cambio en la programación de {{subject}}, del curso {{course_name}}.\n\n{{session_name}} se celebrará el {{day}} de {{month}} de {{year}} a las {{time}}.\n\n{{extra_notes}}\n\nAntes de la clase, revisad:\n{{preparation}}\n\nGracias por vuestra comprensión.\n\nUn saludo,\n{{coordinator_name}}\n{{signature}}',
      updatedAt: TEMPLATE_DATE,
    },
    weeklyTemplate(),
  ];
}

export function createInitialState() {
  return {
    version: 1,
    catalogVersion: CATALOG_VERSION,
    courses: [],
    templates: initialTemplates(),
    drafts: [],
    settings: { name: '', email: '', signature: 'Coordinación académica' },
    composer: null,
  };
}

function makeStudents(prefix, names) {
  return names.map((name, index) => ({
    id: `${prefix}-student-${index + 1}`,
    name,
    email: `${prefix}.estudiante${index + 1}@example.com`,
  }));
}

function makeModules(prefix, topics, lessonTitles, dates) {
  const modules = [];
  for (let index = 0; index < topics.length; index += 1) {
    const session = index + 1;
    const moduleId = `${prefix}-module-${session}`;
    modules.push({
      id: moduleId,
      name: `Sesión ${session} | ${topics[index]} - Asincrónico`,
      position: modules.length + 1,
      items: lessonTitles[index].map((title, itemIndex) => ({
        id: `${moduleId}-item-${itemIndex + 1}`,
        title: `${session}.${itemIndex + 1} Vídeo: ${title}`,
        type: 'Page',
        position: itemIndex + 1,
        page_url: `${prefix}-leccion-${session}-${itemIndex + 1}`,
        completion_requirement: { type: 'must_view', completed: false },
      })),
    });
    if (session % 2 === 0) {
      const liveNumber = session / 2;
      const liveId = `${prefix}-live-${liveNumber}`;
      modules.push({
        id: liveId,
        name: `Clase sincrónica ${liveNumber} | ${topics[index]}`,
        position: modules.length + 1,
        items: [
          {
            id: `${liveId}-before`,
            title: `Antes de la clase ${liveNumber}`,
            type: 'SubHeader',
            position: 1,
          },
          {
            id: `${liveId}-questions`,
            title: 'Preguntas para el encuentro',
            type: 'Discussion',
            position: 2,
          },
          {
            id: `${liveId}-after`,
            title: `Después de la clase ${liveNumber} [${dates[liveNumber - 1]}]`,
            type: 'SubHeader',
            position: 3,
          },
          {
            id: `${liveId}-recording`,
            title: `Grabación de la clase ${liveNumber}`,
            type: 'Page',
            position: 4,
            page_url: `${prefix}-grabacion-${liveNumber}`,
          },
        ],
      });
    }
  }
  return modules;
}

export function createDemoCourses() {
  return [
    {
      id: 'demo-philosophy',
      name: 'Grado en Filosofía · 2.º A (DEMO)',
      subject: 'Ética',
      code: 'FIL-201',
      color: '#7765D4',
      isDemo: true,
      students: makeStudents('fil', ['Alba Navarro', 'Bruno López', 'Clara Martín', 'Diego Santos', 'Elena Vidal', 'Gabriel Ruiz', 'Inés Romero', 'Leo Torres']),
      modules: makeModules('fil',
        ['Introducción a la ética', 'El juicio moral', 'Virtud y vida buena', 'Dilemas contemporáneos'],
        [
          ['Qué significa actuar bien', 'Ética y vida cotidiana', 'Preguntas fundamentales'],
          ['Razones para actuar', 'Normas y responsabilidad', 'Análisis de un caso'],
          ['La virtud en Aristóteles', 'Hábitos y carácter', 'Felicidad y comunidad'],
          ['Justicia y cuidado', 'Tecnología y responsabilidad', 'Cómo argumentar un dilema'],
        ], ['13/10/2026', '27/10/2026']),
      pages: [],
    },
    {
      id: 'demo-economics',
      name: 'Grado en Economía · 1.º A (DEMO)',
      subject: 'Introducción a la economía',
      code: 'ECO-101',
      color: '#247C78',
      isDemo: true,
      students: makeStudents('eco', ['Adriana Costa', 'Carlos Mora', 'Eva Serrano', 'Hugo Molina', 'Irene Gil', 'Jaime Pascual']),
      modules: makeModules('eco',
        ['Decisiones y recursos', 'Oferta y demanda', 'Mercados y bienestar', 'Indicadores económicos'],
        [
          ['Escasez y elección', 'El coste de oportunidad', 'Incentivos y decisiones'],
          ['La curva de demanda', 'La curva de oferta', 'Equilibrio de mercado'],
          ['Excedente del consumidor', 'Competencia y eficiencia', 'Fallos de mercado'],
          ['Producción y renta', 'Precios e inflación', 'Empleo y ciclo económico'],
        ], ['14/10/2026', '28/10/2026']),
      pages: [],
    },
    {
      id: 'demo-education',
      name: 'Máster en Educación · Grupo B (DEMO)',
      subject: 'Diseño de experiencias de aprendizaje',
      code: 'EDU-502',
      color: '#B97844',
      isDemo: true,
      students: makeStudents('edu', ['Alicia Vega', 'Daniel Ríos', 'Laura Montes', 'Marcos Soler', 'Nora Campos', 'Pablo León']),
      modules: makeModules('edu',
        ['Objetivos de aprendizaje', 'Diseño de actividades', 'Evaluación formativa', 'Aprendizaje inclusivo'],
        [
          ['Qué aprenderá el estudiante', 'Resultados observables', 'Alineación de la propuesta'],
          ['Actividades con propósito', 'Secuencias y ritmos', 'Aprendizaje colaborativo'],
          ['Evidencias de aprendizaje', 'Rúbricas y criterios', 'Retroalimentación útil'],
          ['Barreras para participar', 'Opciones de acceso', 'Revisión de una experiencia'],
        ], ['15/10/2026', '29/10/2026']),
      pages: [],
    },
  ];
}

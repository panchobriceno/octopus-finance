const CONFIG = Object.freeze({
  spreadsheetId: '1xXQAd7BD-7sSij4qy5H937_Lbtm7xbdxYmFeu4E369c',
  sheetName: 'Hoja 1',
  headerRow: 1,
  accessToken: '',
  logSheetName: 'Revision Log',
  allowedStatuses: ['Pendiente', 'Aprobado', 'Requiere cambios', 'Rechazado'],
  recommendedColumns: [
    'Visible Cliente',
    'Link Preview',
    'Estado Cliente',
    'Feedback Cliente',
    'Fecha Revision',
    'Revisado Por',
    'Ultima Actualizacion',
  ],
  aliases: {
    rowId: ['ID', '#'],
    publishDate: ['Fecha'],
    day: ['Dia', 'Día'],
    platform: ['Red'],
    category: ['Categoria', 'Categoría'],
    format: ['Formato'],
    kpi: ['KPI Primario'],
    topic: ['Tema / Idea', 'Tema/Idea', 'Tema'],
    hook: ['Hook'],
    visualBrief: ['Guion Visual', 'Guión Visual'],
    copy: ['Copywrite', 'Copy'],
    cta: ['CTA'],
    hashtags: ['Hashtags'],
    assets: ['Activos Requeridos'],
    previewUrl: ['Link Preview', 'Preview URL', 'URL Preview'],
    clientVisible: ['Visible Cliente'],
    clientStatus: ['Estado Cliente', 'Estado'],
    clientFeedback: ['Feedback Cliente', 'Feedback'],
    reviewedAt: ['Fecha Revision', 'Fecha Feedback'],
    reviewedBy: ['Revisado Por', 'Aprobado por'],
    updatedAt: ['Ultima Actualizacion', 'Última Actualización'],
  },
  uiTitle: 'Revision de calendario',
});

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.boot = JSON.stringify({
    title: CONFIG.uiTitle,
    accessToken: (e && e.parameter && e.parameter.token) || '',
  });

  return template
    .evaluate()
    .setTitle(CONFIG.uiTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getBootstrapData(accessToken) {
  validateAccessToken_(accessToken);
  return buildBootstrap_();
}

function submitReview(payload, accessToken) {
  validateAccessToken_(accessToken);

  if (!payload || !payload.rowNumber) {
    throw new Error('Falta la fila a actualizar.');
  }

  const reviewerName = trimString_(payload.reviewerName);
  if (!reviewerName) {
    throw new Error('Debes ingresar tu nombre antes de revisar una pieza.');
  }

  const nextStatus = normalizeStatus_(payload.status);
  const feedback = trimString_(payload.feedback);

  if (nextStatus !== 'Aprobado' && !feedback) {
    throw new Error('Debes dejar feedback para pedir cambios o rechazar.');
  }

  const sheet = getContentSheet_();
  ensureWorkflowColumns_(sheet);

  const headerMap = getHeaderMap_(sheet);
  const rowNumber = Number(payload.rowNumber);

  if (rowNumber <= CONFIG.headerRow || rowNumber > sheet.getLastRow()) {
    throw new Error('La fila seleccionada no existe.');
  }

  const rowRange = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn());
  const rowValues = rowRange.getValues()[0];
  const rowDisplay = rowRange.getDisplayValues()[0];
  const previousStatus = buildItem_(headerMap, rowValues, rowDisplay, rowNumber).status;
  const now = new Date();

  const statusColumn = getColumnIndex_(headerMap, ['Estado Cliente']) || getColumnIndex_(headerMap, CONFIG.aliases.clientStatus);
  const feedbackColumn = getColumnIndex_(headerMap, ['Feedback Cliente']) || getColumnIndex_(headerMap, CONFIG.aliases.clientFeedback);
  const reviewedAtColumn = getColumnIndex_(headerMap, CONFIG.aliases.reviewedAt);
  const reviewedByColumn = getColumnIndex_(headerMap, CONFIG.aliases.reviewedBy);
  const updatedAtColumn = getColumnIndex_(headerMap, CONFIG.aliases.updatedAt);

  if (!statusColumn || !feedbackColumn) {
    throw new Error('No se pudieron resolver las columnas de revision.');
  }

  sheet.getRange(rowNumber, statusColumn).setValue(nextStatus);
  sheet.getRange(rowNumber, feedbackColumn).setValue(feedback);

  if (reviewedAtColumn) {
    sheet.getRange(rowNumber, reviewedAtColumn).setValue(now);
  }

  if (reviewedByColumn) {
    sheet.getRange(rowNumber, reviewedByColumn).setValue(reviewerName);
  }

  if (updatedAtColumn) {
    sheet.getRange(rowNumber, updatedAtColumn).setValue(now);
  }

  appendReviewLog_(sheet, headerMap, rowNumber, previousStatus, nextStatus, feedback, reviewerName, now);

  return {
    item: readSingleItem_(sheet, rowNumber),
    summary: computeSummary_(readAllItems_(sheet)),
    message: 'Revision guardada correctamente.',
  };
}

function setupWorkflow() {
  const sheet = getContentSheet_();
  const addedColumns = ensureWorkflowColumns_(sheet);
  const logSheet = ensureLogSheet_();
  const headerMap = getHeaderMap_(sheet);
  const statusColumn = getColumnIndex_(headerMap, ['Estado Cliente']);

  if (statusColumn) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(CONFIG.allowedStatuses, true)
      .setAllowInvalid(false)
      .build();

    sheet
      .getRange(CONFIG.headerRow + 1, statusColumn, Math.max(sheet.getMaxRows() - CONFIG.headerRow, 1), 1)
      .setDataValidation(rule);
  }

  sheet.setFrozenRows(CONFIG.headerRow);

  const initialized = initializeExistingRows_(sheet, headerMap);

  return {
    addedColumns: addedColumns,
    logSheetName: logSheet.getName(),
    initializedRows: initialized.initializedRows,
    copiedFeedbackRows: initialized.copiedFeedbackRows,
  };
}

function buildBootstrap_() {
  const sheet = getContentSheet_();
  const items = readAllItems_(sheet);
  const spreadsheet = getSpreadsheet_();

  return {
    title: CONFIG.uiTitle,
    subtitle: spreadsheet.getName(),
    generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    summary: computeSummary_(items),
    filters: buildFilters_(items),
    items: items,
  };
}

function readAllItems_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow <= CONFIG.headerRow || lastColumn === 0) {
    return [];
  }

  const range = sheet.getRange(1, 1, lastRow, lastColumn);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headerMap = getHeaderMap_(sheet);
  const items = [];

  for (let rowIndex = CONFIG.headerRow; rowIndex < values.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const item = buildItem_(headerMap, values[rowIndex], displayValues[rowIndex], rowNumber);

    if (!item.visibleToClient) {
      continue;
    }

    if (!hasClientContent_(item)) {
      continue;
    }

    items.push(item);
  }

  items.sort((left, right) => {
    const leftDate = left.publishDateIso || '';
    const rightDate = right.publishDateIso || '';

    if (leftDate !== rightDate) {
      return leftDate < rightDate ? -1 : 1;
    }

    return left.rowNumber - right.rowNumber;
  });

  return items;
}

function readSingleItem_(sheet, rowNumber) {
  const range = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn());
  const values = range.getValues()[0];
  const displayValues = range.getDisplayValues()[0];
  const headerMap = getHeaderMap_(sheet);

  return buildItem_(headerMap, values, displayValues, rowNumber);
}

function buildItem_(headerMap, rowValues, rowDisplay, rowNumber) {
  const rowId = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.rowId);
  const publishDate = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.publishDate);
  const topic = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.topic);
  const statusValue = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.clientStatus);
  const feedbackValue = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.clientFeedback);
  const reviewedBy = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.reviewedBy);
  const reviewedAt = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.reviewedAt);
  const formatValue = trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.format).display);
  const dateObject = getDateObject_(publishDate.value);

  const status = normalizeStatus_(statusValue.value);

  return {
    rowNumber: rowNumber,
    id: trimString_(rowId.display) || String(rowNumber - CONFIG.headerRow),
    publishDate: formatDateValue_(publishDate.value, publishDate.display),
    publishDateFull: formatDateFull_(publishDate.value, publishDate.display),
    publishDateIso: formatIsoDate_(publishDate.value),
    monthKey: buildMonthKey_(dateObject),
    monthLabel: buildMonthLabel_(dateObject),
    weekOfMonth: getWeekOfMonth_(dateObject),
    day: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.day).display),
    platform: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.platform).display),
    category: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.category).display),
    format: formatValue,
    contentType: inferContentType_(formatValue),
    kpi: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.kpi).display),
    topic: trimString_(topic.display),
    hook: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.hook).display),
    visualBrief: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.visualBrief).display),
    copy: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.copy).display),
    cta: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.cta).display),
    hashtags: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.hashtags).display),
    assets: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.assets).display),
    previewUrl: trimString_(resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.previewUrl).display),
    status: status,
    statusMeta: getStatusMeta_(status),
    feedback: trimString_(feedbackValue.display),
    reviewedBy: trimString_(reviewedBy.display),
    reviewedAt: formatDateValue_(reviewedAt.value, reviewedAt.display),
    visibleToClient: isClientVisible_(rowValues, rowDisplay, headerMap),
  };
}

function computeSummary_(items) {
  const summary = {
    total: items.length,
    pendiente: 0,
    aprobado: 0,
    requiereCambios: 0,
    rechazado: 0,
    approvalPercentage: 0,
    byType: {
      Reel: 0,
      Story: 0,
      'Post/Carrusel': 0,
    },
  };

  items.forEach((item) => {
    if (summary.byType[item.contentType] === undefined) {
      summary.byType[item.contentType] = 0;
    }

    summary.byType[item.contentType] += 1;

    if (item.status === 'Aprobado') {
      summary.aprobado += 1;
    } else if (item.status === 'Requiere cambios') {
      summary.requiereCambios += 1;
    } else if (item.status === 'Rechazado') {
      summary.rechazado += 1;
    } else {
      summary.pendiente += 1;
    }
  });

  summary.approvalPercentage = summary.total ? Math.round((summary.aprobado / summary.total) * 100) : 0;

  return summary;
}

function buildFilters_(items) {
  return {
    statuses: CONFIG.allowedStatuses,
    platforms: unique_(items.map((item) => item.platform).filter(Boolean)),
    categories: unique_(items.map((item) => item.category).filter(Boolean)),
    types: unique_(items.map((item) => item.contentType).filter(Boolean)),
    weeks: unique_(items.map((item) => item.weekOfMonth).filter(Boolean)),
  };
}

function appendReviewLog_(sheet, headerMap, rowNumber, previousStatus, nextStatus, feedback, reviewerName, timestamp) {
  const logSheet = ensureLogSheet_();
  const item = readSingleItem_(sheet, rowNumber);

  logSheet.appendRow([
    timestamp,
    rowNumber,
    item.id,
    item.publishDate,
    item.topic,
    previousStatus,
    nextStatus,
    feedback,
    reviewerName,
  ]);
}

function ensureLogSheet_() {
  const spreadsheet = getSpreadsheet_();
  let logSheet = spreadsheet.getSheetByName(CONFIG.logSheetName);

  if (logSheet) {
    const currentHeaders = logSheet.getRange(1, 1, 1, Math.max(logSheet.getLastColumn(), 9)).getDisplayValues()[0];
    if (!trimString_(currentHeaders[0])) {
      logSheet.getRange(1, 1, 1, 9).setValues([[
        'Timestamp',
        'Row Number',
        'Piece ID',
        'Fecha',
        'Tema',
        'Estado anterior',
        'Estado nuevo',
        'Feedback',
        'Revisado por',
      ]]);
    }

    logSheet.setFrozenRows(1);
    return logSheet;
  }

  logSheet = spreadsheet.insertSheet(CONFIG.logSheetName);
  logSheet.getRange(1, 1, 1, 9).setValues([[
    'Timestamp',
    'Row Number',
    'Piece ID',
    'Fecha',
    'Tema',
    'Estado anterior',
    'Estado nuevo',
    'Feedback',
    'Revisado por',
  ]]);
  logSheet.setFrozenRows(1);

  return logSheet;
}

function ensureWorkflowColumns_(sheet) {
  const headerMap = getHeaderMap_(sheet);
  const missingColumns = CONFIG.recommendedColumns.filter((header) => !getColumnIndex_(headerMap, [header]));

  if (!missingColumns.length) {
    return [];
  }

  const currentLastColumn = sheet.getLastColumn();
  sheet.insertColumnsAfter(currentLastColumn, missingColumns.length);
  sheet.getRange(CONFIG.headerRow, currentLastColumn + 1, 1, missingColumns.length).setValues([missingColumns]);

  return missingColumns;
}

function initializeExistingRows_(sheet, headerMap) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= CONFIG.headerRow) {
    return {
      initializedRows: 0,
      copiedFeedbackRows: 0,
    };
  }

  const numRows = lastRow - CONFIG.headerRow;
  const visibleColumn = getColumnIndex_(headerMap, ['Visible Cliente']);
  const statusColumn = getColumnIndex_(headerMap, ['Estado Cliente']);
  const feedbackColumn = getColumnIndex_(headerMap, ['Feedback Cliente']);
  const oldStatusColumn = getColumnIndex_(headerMap, ['Estado']);
  const oldFeedbackColumn = getColumnIndex_(headerMap, ['Feedback']);

  const visibleValues = visibleColumn ? sheet.getRange(2, visibleColumn, numRows, 1).getValues() : null;
  const statusValues = statusColumn ? sheet.getRange(2, statusColumn, numRows, 1).getValues() : null;
  const feedbackValues = feedbackColumn ? sheet.getRange(2, feedbackColumn, numRows, 1).getValues() : null;
  const allValues = sheet.getRange(2, 1, numRows, sheet.getLastColumn()).getValues();

  let initializedRows = 0;
  let copiedFeedbackRows = 0;

  for (let rowIndex = 0; rowIndex < numRows; rowIndex += 1) {
    const row = allValues[rowIndex];
    const hasContent = hasMeaningfulValue_(row[getColumnIndex_(headerMap, CONFIG.aliases.publishDate) - 1]) ||
      hasMeaningfulValue_(row[getColumnIndex_(headerMap, CONFIG.aliases.topic) - 1]) ||
      hasMeaningfulValue_(row[getColumnIndex_(headerMap, CONFIG.aliases.hook) - 1]) ||
      hasMeaningfulValue_(row[getColumnIndex_(headerMap, CONFIG.aliases.visualBrief) - 1]) ||
      hasMeaningfulValue_(row[getColumnIndex_(headerMap, CONFIG.aliases.copy) - 1]);

    if (!hasContent) {
      continue;
    }

    initializedRows += 1;

    if (visibleValues && !hasMeaningfulValue_(visibleValues[rowIndex][0])) {
      visibleValues[rowIndex][0] = true;
    }

    if (statusValues && !hasMeaningfulValue_(statusValues[rowIndex][0])) {
      const legacyStatus = oldStatusColumn ? row[oldStatusColumn - 1] : '';
      statusValues[rowIndex][0] = normalizeStatus_(legacyStatus);
    }

    if (feedbackValues && !hasMeaningfulValue_(feedbackValues[rowIndex][0]) && oldFeedbackColumn) {
      const legacyFeedback = row[oldFeedbackColumn - 1];
      if (hasMeaningfulValue_(legacyFeedback)) {
        feedbackValues[rowIndex][0] = legacyFeedback;
        copiedFeedbackRows += 1;
      }
    }
  }

  if (visibleValues) {
    sheet.getRange(2, visibleColumn, numRows, 1).setValues(visibleValues);
  }

  if (statusValues) {
    sheet.getRange(2, statusColumn, numRows, 1).setValues(statusValues);
  }

  if (feedbackValues) {
    sheet.getRange(2, feedbackColumn, numRows, 1).setValues(feedbackValues);
  }

  return {
    initializedRows: initializedRows,
    copiedFeedbackRows: copiedFeedbackRows,
  };
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.spreadsheetId);
}

function getContentSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.sheetName);

  if (!sheet) {
    throw new Error(`No existe la hoja "${CONFIG.sheetName}".`);
  }

  return sheet;
}

function getHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (!lastColumn) {
    return {};
  }

  const headers = sheet.getRange(CONFIG.headerRow, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {};

  headers.forEach((header, index) => {
    map[normalizeHeader_(header)] = index + 1;
  });

  return map;
}

function getColumnIndex_(headerMap, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const column = headerMap[normalizeHeader_(aliases[index])];

    if (column) {
      return column;
    }
  }

  return null;
}

function resolveValue_(rowValues, rowDisplay, headerMap, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const column = getColumnIndex_(headerMap, [aliases[index]]);

    if (!column) {
      continue;
    }

    const value = rowValues[column - 1];
    const display = rowDisplay[column - 1];

    if (hasMeaningfulValue_(value) || hasMeaningfulValue_(display)) {
      return {
        column: column,
        value: value,
        display: display,
      };
    }
  }

  return {
    column: null,
    value: '',
    display: '',
  };
}

function hasMeaningfulValue_(value) {
  if (value === false || value === 0) {
    return true;
  }

  if (value instanceof Date) {
    return true;
  }

  return trimString_(value) !== '';
}

function isClientVisible_(rowValues, rowDisplay, headerMap) {
  const visibleValue = resolveValue_(rowValues, rowDisplay, headerMap, CONFIG.aliases.clientVisible);

  if (!visibleValue.column) {
    return true;
  }

  const rawValue = visibleValue.value;
  const rawString = normalizeHeader_(visibleValue.display || rawValue);

  if (rawValue === false) {
    return false;
  }

  if (rawString === 'false' || rawString === 'no' || rawString === 'oculto') {
    return false;
  }

  return true;
}

function hasClientContent_(item) {
  return Boolean(
    item.topic ||
    item.hook ||
    item.copy ||
    item.visualBrief ||
    item.publishDate
  );
}

function normalizeStatus_(rawValue) {
  if (rawValue === true) {
    return 'Aprobado';
  }

  if (rawValue === false || rawValue === '' || rawValue === null || typeof rawValue === 'undefined') {
    return 'Pendiente';
  }

  const normalized = normalizeHeader_(rawValue);

  if (!normalized || normalized === 'false' || normalized === 'pendiente') {
    return 'Pendiente';
  }

  if (normalized === 'true' || normalized === 'aprobado' || normalized === 'approved') {
    return 'Aprobado';
  }

  if (normalized === 'requiere cambios' || normalized === 'requierecambios' || normalized === 'cambios') {
    return 'Requiere cambios';
  }

  if (normalized === 'rechazado' || normalized === 'rejected') {
    return 'Rechazado';
  }

  return 'Pendiente';
}

function getStatusMeta_(status) {
  if (status === 'Aprobado') {
    return { tone: 'approved', label: 'Aprobado' };
  }

  if (status === 'Requiere cambios') {
    return { tone: 'changes', label: 'Requiere cambios' };
  }

  if (status === 'Rechazado') {
    return { tone: 'rejected', label: 'Rechazado' };
  }

  return { tone: 'pending', label: 'Pendiente' };
}

function formatDateValue_(value, displayValue) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM');
  }

  return trimString_(displayValue || value);
}

function formatDateFull_(value, displayValue) {
  const dateObject = getDateObject_(value);

  if (!dateObject) {
    return trimString_(displayValue || value);
  }

  const days = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  return `${days[dateObject.getDay()]} ${dateObject.getDate()} de ${months[dateObject.getMonth()]} de ${dateObject.getFullYear()}`;
}

function formatIsoDate_(value) {
  const dateObject = getDateObject_(value);

  if (!dateObject) {
    return '';
  }

  return Utilities.formatDate(dateObject, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getDateObject_(value) {
  if (value instanceof Date && !isNaN(value)) {
    return new Date(value.getTime());
  }

  const text = trimString_(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function buildMonthKey_(dateObject) {
  if (!dateObject) {
    return '';
  }

  return Utilities.formatDate(dateObject, Session.getScriptTimeZone(), 'yyyy-MM');
}

function buildMonthLabel_(dateObject) {
  if (!dateObject) {
    return '';
  }

  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${months[dateObject.getMonth()]} ${dateObject.getFullYear()}`;
}

function getWeekOfMonth_(dateObject) {
  if (!dateObject) {
    return null;
  }

  const day = dateObject.getDate();
  if (day <= 7) {
    return 1;
  }

  if (day <= 14) {
    return 2;
  }

  if (day <= 21) {
    return 3;
  }

  if (day <= 28) {
    return 4;
  }

  return 5;
}

function inferContentType_(formatValue) {
  const normalized = normalizeHeader_(formatValue);

  if (normalized.indexOf('reel') > -1) {
    return 'Reel';
  }

  if (normalized.indexOf('story') > -1) {
    return 'Story';
  }

  return 'Post/Carrusel';
}

function trimString_(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeHeader_(value) {
  return trimString_(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function unique_(values) {
  return [...new Set(values)].sort((left, right) => {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }

    return String(left).localeCompare(String(right), 'es');
  });
}

function validateAccessToken_(incomingToken) {
  if (!CONFIG.accessToken) {
    return;
  }

  if (trimString_(incomingToken) !== CONFIG.accessToken) {
    throw new Error('Token invalido.');
  }
}

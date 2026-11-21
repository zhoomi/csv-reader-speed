// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Same broken-row policy, byte for byte:
//  - U+FEFF at the very start is dropped;
//  - a record ends at LF or CRLF, a line left with no characters is no record;
//  - outside quotes a CR not followed by LF is dropped (stray_cr);
//  - a field that opens with a quote runs to the next quote that is not doubled,
//    "" inside it is one quote, each CRLF or lone CR inside it is read as LF;
//    what follows its closing quote, up to the next comma or line break, is
//    appended as it stands (quote_junk, when the field ends); a quote that never
//    closes is a literal character, and the text after it is read again as
//    unquoted (unterminated_quote);
//  - a quote inside an unquoted field is a literal character;
//  - fields stay strings, never trimmed or converted;
//  - columns is the first record when header is true, else null; rows holds the
//    records after it (every record when header is false), each padded with ""
//    (short_row, with fields: its field count) or cut (long_row, with extra:
//    the cut fields) to the first record's width;
//  - each error is {code, line, row}, in the order met, a field's quote_junk
//    when the field ends and a record's short_row or long_row when the record
//    ends; line is the 1-based line its record starts on, row its record's
//    index in rows, null for the header.
//
// Speed: the reference builds every field a character at a time. This reader
// instead finds each field's end first and slices it once, and takes a whole
// record at a time (one native split) when the record holds no quote and no
// stray CR, which is the common case. No regex anywhere in the hot path.

const COMMA = 44; // ','
const LF = 10; // '\n'
const CR = 13; // '\r'
const QUOTE = 34; // '"'
const FEFF = 0xfeff;

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const END_COMMA = 0;
const END_BREAK = 1;
const END_TEXT = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === FEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended (END_COMMA/END_BREAK/END_TEXT) and how many characters
  // the unquoted reader kept onto the field's initial value. Shared by the field
  // readers so they return just the string instead of allocating a result object
  // per field (the biggest allocation in the hot path, and the GC it causes).
  let fEnded = END_TEXT;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `init` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns the field string, sets fEnded and
  // fAdded. Scans for the end first, slices once.
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === COMMA) {
        value += text.slice(start, pos);
        added += pos - start;
        pos += 1;
        fEnded = END_COMMA;
        fAdded = added;
        return value;
      }
      if (c === LF) {
        value += text.slice(start, pos);
        added += pos - start;
        pos += 1;
        line += 1;
        fEnded = END_BREAK;
        fAdded = added;
        return value;
      }
      if (c === CR) {
        if (text.charCodeAt(pos + 1) === LF) {
          value += text.slice(start, pos);
          added += pos - start;
          pos += 2;
          line += 1;
          fEnded = END_BREAK;
          fAdded = added;
          return value;
        }
        error('stray_cr');
        value += text.slice(start, pos);
        added += pos - start;
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    value += text.slice(start, pos);
    added += pos - start;
    fEnded = END_TEXT;
    fAdded = added;
    return value;
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field string,
  // sets fEnded and fAdded (fAdded is the junk appended after the closing quote).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let segStart = pos;
    let closed = false;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === QUOTE) {
        if (text.charCodeAt(pos + 1) === QUOTE) {
          // "" inside: one quote. Flush the segment, append it, resume after the pair.
          value += text.slice(segStart, pos);
          value += '"';
          pos += 2;
          segStart = pos;
          continue;
        }
        value += text.slice(segStart, pos);
        pos += 1;
        closed = true;
        break;
      }
      if (c === CR) {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(segStart, pos);
        value += '\n';
        line += 1;
        pos += text.charCodeAt(pos + 1) === LF ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (c === LF) line += 1;
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted. The scan above is thrown away with its line count.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) {
      fEnded = END_TEXT;
      fAdded = 0;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      fEnded = END_COMMA;
      fAdded = 0;
      return value;
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      fEnded = END_BREAK;
      fAdded = 0;
      return value;
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      fEnded = END_BREAK;
      fAdded = 0;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junkValue = readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
    return junkValue;
  }

  // Finishes a record's fields: sets the width from the first record, takes the header,
  // or pads/cuts the row to the width and pushes it. Returns true when a row was pushed
  // (false only for the header).
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return false;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text.charCodeAt(pos) === LF) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record holds no quote and no stray CR, so it ends at the next LF
    // (or the end of the text) and its fields are one native split apart.
    const lf = text.indexOf('\n', pos);
    const end = lf === -1 ? len : lf;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= end) {
      const cr = text.indexOf('\r', pos);
      if (cr === -1 || cr >= end || (lf !== -1 && cr === end - 1)) {
        // Clean record. (When cr === end - 1 the record ends in CRLF; the \r is the
        // terminator, not a stray CR. When lf === -1 a \r in the span is a stray CR,
        // so that case does not reach here.)
        let lineEnd = end;
        if (lf !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === CR) lineEnd -= 1;
        const fields = text.slice(pos, lineEnd).split(',');
        pos = lf === -1 ? len : lf + 1;
        if (lf !== -1) line += 1;
        // A line that held only stray CRs is left with no characters: no record.
        // (Unreachable here: such a line holds a \r, so it takes the slow path.
        // Kept for exactness with the reference.)
        if (fields.length === 1 && fields[0] === '') continue;
        finishRecord(fields);
        continue;
      }
    }

    // Slow path: the record holds a quote or a stray CR. Read it field by field.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === QUOTE;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field);
    } while (fEnded === END_COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

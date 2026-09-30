// CSV 入出力(配線表のインポート/エクスポート)
// Excel(Windows/Mac)でそのまま開けるよう UTF-8 BOM 付きで出力する。

export const CSV_COLUMNS = [
  { key: "from", label: "接続元" },
  { key: "fromTerminal", label: "接続元端子" },
  { key: "to", label: "接続先" },
  { key: "toTerminal", label: "接続先端子" },
  { key: "cableType", label: "ケーブル種別" },
  { key: "cableNo", label: "ケーブルNo" },
  { key: "length", label: "長さ(m)" },
  { key: "color", label: "色" },
  { key: "note", label: "備考" },
];

function escapeCsvField(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function rowsToCsv(rows) {
  const header = CSV_COLUMNS.map((c) => c.label).join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((c) => escapeCsvField(row[c.key])).join(",")
  );
  return "﻿" + [header, ...lines].join("\r\n") + "\r\n";
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// シンプルな RFC4180 準拠 CSV パーサ(引用符・改行入りフィールドに対応)
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // skip, handled by \n or end
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// CSV テキスト -> 配線行オブジェクトの配列。見出し行の並びは柔軟に解決する。
export function csvToRows(text) {
  const table = parseCsv(text);
  if (table.length === 0) return [];
  const header = table[0].map((h) => h.trim());
  const colIndexByKey = {};
  CSV_COLUMNS.forEach((c) => {
    const idx = header.findIndex((h) => h === c.label);
    if (idx !== -1) colIndexByKey[c.key] = idx;
  });
  const dataRows = table.slice(1);
  return dataRows.map((cells) => {
    const obj = {};
    CSV_COLUMNS.forEach((c) => {
      const idx = colIndexByKey[c.key];
      obj[c.key] = idx != null ? (cells[idx] ?? "") : "";
    });
    return obj;
  });
}

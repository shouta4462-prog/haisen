import { db, uid } from "./db.js";
import { rowsToCsv, downloadCsv, csvToRows } from "./csv.js";
import * as cloud from "./cloud.js";

// ===================== 状態 =====================
const state = {
  sheets: [],
  activeSheetId: null,
  rows: [], // アクティブな配線表の行
  searchTerm: "",
  cloudUser: null,
};

// 1シート = 1つの端子台。行は「その端子台の1つの端子」を表す。
const ROW_FIELDS = [
  "terminalNo",
  "to",
  "toTerminal",
  "cableType",
  "cableNo",
  "length",
  "color",
  "note",
];

// ===================== DOM 参照 =====================
const $ = (sel) => document.querySelector(sel);
const el = {
  sheetTitle: $("#sheet-title"),
  syncStatus: $("#sync-status"),
  drawer: $("#sheet-drawer"),
  drawerBackdrop: $("#drawer-backdrop"),
  sheetList: $("#sheet-list"),
  btnMenu: $("#btn-menu"),
  btnCloseDrawer: $("#btn-close-drawer"),
  btnNewSheet: $("#btn-new-sheet"),
  btnAddRow: $("#btn-add-row"),
  btnImportCsv: $("#btn-import-csv"),
  btnExportCsv: $("#btn-export-csv"),
  csvFileInput: $("#csv-file-input"),
  searchBox: $("#search-box"),
  tbody: $("#wire-tbody"),
  emptyHint: $("#empty-hint"),
  rowCount: $("#row-count"),
  btnAccount: $("#btn-account"),
  accountModal: $("#account-modal"),
  accountBody: $("#account-body"),
  btnCloseAccount: $("#btn-close-account"),
  toast: $("#toast"),
};

// ===================== ユーティリティ =====================
let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2200);
}

function debounce(fn, wait) {
  const timers = new Map();
  return (key, ...args) => {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => fn(...args), wait)
    );
  };
}

function setSyncStatus(text, kind) {
  el.syncStatus.textContent = text;
  el.syncStatus.classList.remove("is-synced", "is-error");
  if (kind) el.syncStatus.classList.add(kind);
}

// ===================== 配線表(シート)の読み込み・描画 =====================
async function loadSheets() {
  let sheets = await db.getAllSheets();
  if (sheets.length === 0) {
    const sheet = { id: uid(), name: "端子台1", createdAt: Date.now(), updatedAt: Date.now() };
    await db.putSheet(sheet);
    sheets = [sheet];
  }
  state.sheets = sheets;
  if (!state.activeSheetId || !sheets.find((s) => s.id === state.activeSheetId)) {
    state.activeSheetId = sheets[0].id;
  }
}

function renderSheetList() {
  el.sheetList.innerHTML = "";
  state.sheets.forEach((sheet) => {
    const li = document.createElement("li");
    li.className = sheet.id === state.activeSheetId ? "is-active" : "";
    const nameSpan = document.createElement("span");
    nameSpan.className = "sheet-name";
    nameSpan.textContent = sheet.name;
    li.appendChild(nameSpan);
    const delBtn = document.createElement("button");
    delBtn.className = "sheet-del";
    delBtn.textContent = "✕";
    delBtn.title = "削除";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSheet(sheet.id);
    });
    li.appendChild(delBtn);
    li.addEventListener("click", () => switchSheet(sheet.id));
    el.sheetList.appendChild(li);
  });
}

async function switchSheet(id) {
  if (id === state.activeSheetId) {
    closeDrawer();
    return;
  }
  state.activeSheetId = id;
  await loadRows();
  renderSheetList();
  renderTitle();
  renderRows();
  closeDrawer();
}

function renderTitle() {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  el.sheetTitle.textContent = sheet ? sheet.name : "配線表";
}

async function createSheet() {
  const sheet = {
    id: uid(),
    name: `端子台${state.sheets.length + 1}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.putSheet(sheet);
  cloud.pushSheet(sheet).catch(() => {});
  state.sheets.push(sheet);
  state.activeSheetId = sheet.id;
  state.rows = [];
  renderSheetList();
  renderTitle();
  renderRows();
  closeDrawer();
}

async function deleteSheet(id) {
  if (state.sheets.length <= 1) {
    showToast("最後の端子台は削除できません");
    return;
  }
  if (!confirm("この端子台を削除しますか?中の配線データも削除されます。")) return;
  await db.deleteSheet(id);
  await db.deleteRowsBySheet(id);
  cloud.deleteRemoteSheet(id).catch(() => {});
  state.sheets = state.sheets.filter((s) => s.id !== id);
  if (state.activeSheetId === id) {
    state.activeSheetId = state.sheets[0].id;
    await loadRows();
  }
  renderSheetList();
  renderTitle();
  renderRows();
}

async function renameSheet() {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) return;
  const name = prompt("端子台の名前", sheet.name);
  if (!name || !name.trim()) return;
  sheet.name = name.trim();
  sheet.updatedAt = Date.now();
  await db.putSheet(sheet);
  cloud.pushSheet(sheet).catch(() => {});
  renderSheetList();
  renderTitle();
}

// ===================== 行(配線)の読み込み・描画 =====================
async function loadRows() {
  state.rows = await db.getRowsBySheet(state.activeSheetId);
}

function matchesSearch(row, term) {
  if (!term) return true;
  const hay = ROW_FIELDS.map((f) => row[f] || "").join(" ").toLowerCase();
  return hay.includes(term.toLowerCase());
}

function renderRows() {
  el.tbody.innerHTML = "";
  const term = state.searchTerm.trim();
  const visibleRows = state.rows.filter((r) => matchesSearch(r, term));

  visibleRows.forEach((row, visibleIndex) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;

    const tdNo = document.createElement("td");
    tdNo.className = "col-no";
    tdNo.textContent = String(visibleIndex + 1);
    tr.appendChild(tdNo);

    ROW_FIELDS.forEach((field) => {
      const td = document.createElement("td");
      td.className = field === "length" || field === "color" ? "col-short" : "col-text";
      const input = document.createElement("input");
      input.type = "text";
      input.value = row[field] || "";
      input.autocomplete = "off";
      input.addEventListener("input", () => {
        row[field] = input.value;
        scheduleSaveRow(row.id, row);
      });
      td.appendChild(input);
      tr.appendChild(td);
    });

    const tdAction = document.createElement("td");
    tdAction.className = "col-action";
    const delBtn = document.createElement("button");
    delBtn.className = "row-del-btn";
    delBtn.innerHTML = "🗑";
    delBtn.title = "この行を削除";
    delBtn.addEventListener("click", () => deleteRow(row.id));
    tdAction.appendChild(delBtn);
    tr.appendChild(tdAction);

    el.tbody.appendChild(tr);
  });

  el.emptyHint.hidden = state.rows.length !== 0;
  el.rowCount.textContent = `${visibleRows.length} 件` + (term ? ` / 全 ${state.rows.length} 件` : "");
}

const scheduleSaveRow = debounce(async (row) => {
  row.updatedAt = Date.now();
  await db.putRow(row);
  cloud.pushRow(row).catch(() => {});
}, 400);

async function addRow() {
  const maxOrder = state.rows.reduce((m, r) => Math.max(m, r.order ?? 0), -1);
  const row = {
    id: uid(),
    sheetId: state.activeSheetId,
    order: maxOrder + 1,
    terminalNo: "",
    to: "",
    toTerminal: "",
    cableType: "",
    cableNo: "",
    length: "",
    color: "",
    note: "",
    updatedAt: Date.now(),
  };
  state.rows.push(row);
  await db.putRow(row);
  cloud.pushRow(row).catch(() => {});
  renderRows();
  // 追加した行の最初の入力へフォーカス
  const inputs = el.tbody.querySelectorAll(`tr[data-id="${row.id}"] input`);
  if (inputs[0]) inputs[0].focus();
  el.tbody.closest(".table-wrap").scrollTop = el.tbody.closest(".table-wrap").scrollHeight;
}

async function deleteRow(id) {
  state.rows = state.rows.filter((r) => r.id !== id);
  await db.deleteRow(id);
  cloud.deleteRemoteRow(id).catch(() => {});
  renderRows();
}

// ===================== CSV 入出力 =====================
function handleExportCsv() {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  const csv = rowsToCsv(state.rows);
  const filename = `${(sheet?.name || "端子台").replace(/[\\/:*?"<>|]/g, "_")}.csv`;
  downloadCsv(filename, csv);
  showToast("CSVを書き出しました");
}

async function handleImportCsvFile(file) {
  const text = await file.text();
  const parsed = csvToRows(text);
  if (parsed.length === 0) {
    showToast("読み込める行がありませんでした");
    return;
  }
  const mode = confirm(
    `${parsed.length} 行を読み込みます。\n「OK」= 今の端子台に追記 / 「キャンセル」= 今の端子台を置き換え`
  )
    ? "append"
    : "replace";

  if (mode === "replace") {
    await db.deleteRowsBySheet(state.activeSheetId);
    state.rows.forEach((r) => cloud.deleteRemoteRow(r.id).catch(() => {}));
    state.rows = [];
  }

  const baseOrder = state.rows.reduce((m, r) => Math.max(m, r.order ?? 0), -1) + 1;
  const newRows = parsed.map((data, i) => ({
    id: uid(),
    sheetId: state.activeSheetId,
    order: baseOrder + i,
    updatedAt: Date.now(),
    ...data,
  }));
  await db.putRows(newRows);
  newRows.forEach((r) => cloud.pushRow(r).catch(() => {}));
  state.rows = state.rows.concat(newRows);
  renderRows();
  showToast(`${newRows.length} 行を読み込みました`);
}

// ===================== ドロワー(端子台一覧) =====================
function openDrawer() {
  el.drawer.classList.add("is-open");
  el.drawerBackdrop.hidden = false;
}
function closeDrawer() {
  el.drawer.classList.remove("is-open");
  el.drawerBackdrop.hidden = true;
}

// ===================== 検索 =====================
function handleSearchInput() {
  state.searchTerm = el.searchBox.value;
  renderRows();
}

// ===================== クラウド同期 / アカウントモーダル =====================
function renderAccountModal() {
  const configured = cloud.isConfigured();
  const user = cloud.getCurrentUser();

  if (!configured) {
    el.accountBody.innerHTML = `
      <p>Supabase を使うと、この端子台データをPCとスマホの間でクラウド同期できます。
      未設定でもこのアプリは端末内保存でそのまま使えます。</p>
      <label for="cfg-url">Supabase Project URL</label>
      <input id="cfg-url" type="url" placeholder="https://xxxx.supabase.co" />
      <label for="cfg-key">Supabase anon public key</label>
      <input id="cfg-key" type="text" placeholder="eyJhbGciOi..." />
      <div class="modal__actions">
        <button id="cfg-save" class="btn btn--primary">保存して接続</button>
      </div>
      <p style="margin-top:16px;">セットアップ手順は README.md / supabase-schema.sql を参照してください。</p>
    `;
    $("#cfg-save").addEventListener("click", async () => {
      const url = $("#cfg-url").value.trim();
      const key = $("#cfg-key").value.trim();
      if (!url || !key) {
        showToast("URLとキーを入力してください");
        return;
      }
      await cloud.configure(url, key);
      showToast("接続情報を保存しました");
      renderAccountModal();
    });
    return;
  }

  if (!user) {
    el.accountBody.innerHTML = `
      <p>メールアドレスとパスワードでログイン、または新規登録してください。</p>
      <label for="auth-email">メールアドレス</label>
      <input id="auth-email" type="email" placeholder="you@example.com" />
      <label for="auth-pass">パスワード</label>
      <input id="auth-pass" type="password" placeholder="8文字以上" />
      <div class="modal__actions">
        <button id="auth-signin" class="btn btn--primary">ログイン</button>
        <button id="auth-signup" class="btn">新規登録</button>
      </div>
      <div class="modal__actions">
        <button id="auth-reset" class="btn btn--danger">接続設定をやり直す</button>
      </div>
    `;
    $("#auth-signin").addEventListener("click", () => handleAuth("signIn"));
    $("#auth-signup").addEventListener("click", () => handleAuth("signUp"));
    $("#auth-reset").addEventListener("click", () => {
      cloud.clearConfig();
      renderAccountModal();
    });
    return;
  }

  el.accountBody.innerHTML = `
    <p>ログイン中: <strong>${user.email}</strong></p>
    <p>この端末の端子台データはクラウドと同期されます。</p>
    <div class="modal__actions">
      <button id="cloud-sync-now" class="btn btn--primary">今すぐ同期</button>
      <button id="cloud-signout" class="btn btn--danger">ログアウト</button>
    </div>
  `;
  $("#cloud-sync-now").addEventListener("click", () => syncWithCloud(true));
  $("#cloud-signout").addEventListener("click", async () => {
    await cloud.signOut();
    setSyncStatus("オフライン保存");
    renderAccountModal();
  });
}

async function handleAuth(kind) {
  const email = $("#auth-email").value.trim();
  const password = $("#auth-pass").value;
  if (!email || password.length < 6) {
    showToast("メールアドレスと6文字以上のパスワードを入力してください");
    return;
  }
  try {
    if (kind === "signUp") {
      await cloud.signUp(email, password);
      showToast("登録しました。確認メールがある場合はそちらもご確認ください");
    } else {
      await cloud.signIn(email, password);
      showToast("ログインしました");
    }
    renderAccountModal();
    await syncWithCloud(true);
  } catch (err) {
    showToast("エラー: " + (err.message || err));
  }
}

async function syncWithCloud(showMessage) {
  if (!cloud.isConfigured() || !cloud.getCurrentUser()) return;
  setSyncStatus("同期中…");
  try {
    const remote = await cloud.pullAll();
    const remoteSheetsById = new Map(remote.sheets.map((s) => [s.id, s]));
    const localSheetsById = new Map(state.sheets.map((s) => [s.id, s]));

    // マージ: updatedAt が新しい方を採用。片方にしか無ければそちらを採用。
    const mergedSheets = new Map();
    for (const s of state.sheets) mergedSheets.set(s.id, s);
    for (const rs of remote.sheets) {
      const ls = mergedSheets.get(rs.id);
      if (!ls || rs.updatedAt > ls.updatedAt) mergedSheets.set(rs.id, rs);
    }
    for (const s of mergedSheets.values()) {
      await db.putSheet(s);
      if (!remoteSheetsById.has(s.id) || remoteSheetsById.get(s.id).updatedAt < s.updatedAt) {
        cloud.pushSheet(s).catch(() => {});
      }
    }
    state.sheets = Array.from(mergedSheets.values()).sort((a, b) => a.createdAt - b.createdAt);
    if (!state.sheets.find((s) => s.id === state.activeSheetId)) {
      state.activeSheetId = state.sheets[0]?.id;
    }

    // 行のマージ(全シート分)
    const localRowsAll = [];
    for (const s of state.sheets) {
      localRowsAll.push(...(await db.getRowsBySheet(s.id)));
    }
    const remoteRowsById = new Map(remote.rows.map((r) => [r.id, r]));
    const mergedRows = new Map();
    for (const r of localRowsAll) mergedRows.set(r.id, r);
    for (const rr of remote.rows) {
      const lr = mergedRows.get(rr.id);
      if (!lr || rr.updatedAt > lr.updatedAt) mergedRows.set(rr.id, rr);
    }
    for (const r of mergedRows.values()) {
      await db.putRow(r);
      if (!remoteRowsById.has(r.id) || remoteRowsById.get(r.id).updatedAt < r.updatedAt) {
        cloud.pushRow(r).catch(() => {});
      }
    }

    await loadRows();
    renderSheetList();
    renderTitle();
    renderRows();
    setSyncStatus("同期済み", "is-synced");
    if (showMessage) showToast("同期しました");
  } catch (err) {
    console.error(err);
    setSyncStatus("同期エラー", "is-error");
    if (showMessage) showToast("同期に失敗しました: " + (err.message || err));
  }
}

// ===================== イベント登録 =====================
function bindEvents() {
  el.btnMenu.addEventListener("click", openDrawer);
  el.btnCloseDrawer.addEventListener("click", closeDrawer);
  el.drawerBackdrop.addEventListener("click", closeDrawer);
  el.btnNewSheet.addEventListener("click", createSheet);
  el.btnAddRow.addEventListener("click", addRow);
  el.sheetTitle.addEventListener("click", renameSheet);
  el.searchBox.addEventListener("input", handleSearchInput);

  el.btnExportCsv.addEventListener("click", handleExportCsv);
  el.btnImportCsv.addEventListener("click", () => el.csvFileInput.click());
  el.csvFileInput.addEventListener("change", async () => {
    const file = el.csvFileInput.files[0];
    if (file) await handleImportCsvFile(file);
    el.csvFileInput.value = "";
  });

  el.btnAccount.addEventListener("click", () => {
    el.accountModal.hidden = false;
    renderAccountModal();
  });
  el.btnCloseAccount.addEventListener("click", () => (el.accountModal.hidden = true));
  el.accountModal.addEventListener("click", (e) => {
    if (e.target === el.accountModal) el.accountModal.hidden = true;
  });

  cloud.onAuthChange((user) => {
    state.cloudUser = user;
    if (user) {
      setSyncStatus("同期済み", "is-synced");
    } else if (cloud.isConfigured()) {
      setSyncStatus("未ログイン");
    } else {
      setSyncStatus("オフライン保存");
    }
  });
}

// ===================== 初期化 =====================
async function init() {
  bindEvents();
  await loadSheets();
  await loadRows();
  renderSheetList();
  renderTitle();
  renderRows();

  const user = await cloud.tryAutoConnect().catch(() => null);
  if (user) {
    state.cloudUser = user;
    await syncWithCloud(false);
  } else if (cloud.isConfigured()) {
    setSyncStatus("未ログイン");
  } else {
    setSyncStatus("オフライン保存");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();

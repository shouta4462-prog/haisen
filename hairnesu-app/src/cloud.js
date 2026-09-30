// クラウド同期レイヤー(Supabase)
// 未設定・未ログイン時はすべてローカル(IndexedDB)のみで動作し、
// Supabase の URL / anon key を設定してログインすると、PC・スマホ間で
// 配線表が同期されるようになる。
//
// Supabase の JS SDK はこの端末(ユーザーのブラウザ)側で CDN から
// 取得する。ビルド時に npm パッケージとして同梱しているわけではない。

const SUPABASE_SDK_URL = "https://esm.sh/@supabase/supabase-js@2";
const CONFIG_KEY = "hairnesu-cloud-config"; // { url, anonKey }

let supabaseClient = null;
let currentConfig = null;
let currentUser = null;
let authListeners = [];

export function getStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isConfigured() {
  return !!getStoredConfig();
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  supabaseClient = null;
  currentConfig = null;
  currentUser = null;
}

async function ensureClient() {
  const cfg = getStoredConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  if (supabaseClient && currentConfig && currentConfig.url === cfg.url && currentConfig.anonKey === cfg.anonKey) {
    return supabaseClient;
  }
  const { createClient } = await import(/* @vite-ignore */ SUPABASE_SDK_URL);
  supabaseClient = createClient(cfg.url, cfg.anonKey);
  currentConfig = cfg;
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    authListeners.forEach((fn) => fn(currentUser));
  });
  const { data } = await supabaseClient.auth.getUser();
  currentUser = data?.user ?? null;
  return supabaseClient;
}

export function onAuthChange(fn) {
  authListeners.push(fn);
  return () => {
    authListeners = authListeners.filter((f) => f !== fn);
  };
}

export function getCurrentUser() {
  return currentUser;
}

export async function configure(url, anonKey) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, anonKey }));
  supabaseClient = null;
  return ensureClient();
}

export async function signUp(email, password) {
  const client = await ensureClient();
  if (!client) throw new Error("クラウド未設定です");
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const client = await ensureClient();
  if (!client) throw new Error("クラウド未設定です");
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  return data;
}

export async function signOut() {
  const client = await ensureClient();
  if (!client) return;
  await client.auth.signOut();
  currentUser = null;
}

export async function tryAutoConnect() {
  if (!isConfigured()) return null;
  const client = await ensureClient();
  return client ? currentUser : null;
}

// ---- データ同期(単純な last-write-wins マージ) ----

function sheetToRemote(sheet, userId) {
  return {
    id: sheet.id,
    user_id: userId,
    name: sheet.name,
    created_at: new Date(sheet.createdAt || Date.now()).toISOString(),
    updated_at: new Date(sheet.updatedAt || Date.now()).toISOString(),
  };
}
function sheetFromRemote(r) {
  return {
    id: r.id,
    name: r.name,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}
function rowToRemote(row, userId) {
  return {
    id: row.id,
    sheet_id: row.sheetId,
    user_id: userId,
    order: row.order ?? 0,
    terminal_no: row.terminalNo || "",
    to_location: row.to || "",
    to_terminal: row.toTerminal || "",
    cable_type: row.cableType || "",
    cable_no: row.cableNo || "",
    length: row.length || "",
    color: row.color || "",
    note: row.note || "",
    updated_at: new Date(row.updatedAt || Date.now()).toISOString(),
  };
}
function rowFromRemote(r) {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    order: r.order ?? 0,
    terminalNo: r.terminal_no || "",
    to: r.to_location || "",
    toTerminal: r.to_terminal || "",
    cableType: r.cable_type || "",
    cableNo: r.cable_no || "",
    length: r.length || "",
    color: r.color || "",
    note: r.note || "",
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export async function pushSheet(sheet) {
  const client = await ensureClient();
  if (!client || !currentUser) return;
  await client.from("sheets").upsert(sheetToRemote(sheet, currentUser.id));
}

export async function pushRow(row) {
  const client = await ensureClient();
  if (!client || !currentUser) return;
  await client.from("wire_rows").upsert(rowToRemote(row, currentUser.id));
}

export async function deleteRemoteSheet(id) {
  const client = await ensureClient();
  if (!client || !currentUser) return;
  await client.from("sheets").delete().eq("id", id);
}

export async function deleteRemoteRow(id) {
  const client = await ensureClient();
  if (!client || !currentUser) return;
  await client.from("wire_rows").delete().eq("id", id);
}

// リモートの全データを取得(プル)。マージは呼び出し側(app.js)が
// updatedAt を比較して行う。
export async function pullAll() {
  const client = await ensureClient();
  if (!client || !currentUser) return { sheets: [], rows: [] };
  const [{ data: sheetsData, error: e1 }, { data: rowsData, error: e2 }] = await Promise.all([
    client.from("sheets").select("*").eq("user_id", currentUser.id),
    client.from("wire_rows").select("*").eq("user_id", currentUser.id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return {
    sheets: (sheetsData || []).map(sheetFromRemote),
    rows: (rowsData || []).map(rowFromRemote),
  };
}

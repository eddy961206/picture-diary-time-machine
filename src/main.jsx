import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  buildAppShareUrl,
  buildInviteUrl,
  buildSocialShareUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getInviteCodeFromUrl,
  getSharePageUrl,
  normalizeInviteCode,
} from "./lib/share-utils.js";
import { getSupabaseClient, getSupabaseConfig } from "./lib/supabase-client.js";
import { shareKakaoInvite } from "./lib/kakao-share.js";
import {
  getSeoulDateKey,
  getStreakReward,
  getTodayRitualState,
  MAX_DAILY_GENERATIONS,
  saveSuccessfulGeneration,
  SHARE_LINES,
  writeRitualState,
} from "./lib/ritual-state.js";
import { GENERATION_LOADING_LINES } from "./lib/loading-copy.js";

const PENDING_SAVE_DB = "pictureDiaryPendingSave:v1";
const PENDING_SAVE_STORE = "pending";
const PENDING_SAVE_KEY = "latest";
const PENDING_INVITE_KEY = "pictureDiaryPendingInvite:v1";
const sampleImage = "/sample-output.png";

function readPendingInviteCode() {
  try {
    return normalizeInviteCode(localStorage.getItem(PENDING_INVITE_KEY));
  } catch {
    return "";
  }
}

function writePendingInviteCode(code) {
  const normalized = normalizeInviteCode(code);
  try {
    if (normalized) localStorage.setItem(PENDING_INVITE_KEY, normalized);
  } catch {
    // localStorage can be blocked in private contexts; invite still stays in state.
  }
  return normalized;
}

function clearPendingInviteCode() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // no-op
  }
}

function getInitialInviteCode() {
  if (typeof window === "undefined") return "";
  return getInviteCodeFromUrl(window.location) || readPendingInviteCode();
}

function removeInviteQueryFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hadInvite = ["invite", "invite_code", "code"].some((key) => url.searchParams.has(key));
  if (!hadInvite) return;
  url.searchParams.delete("invite");
  url.searchParams.delete("invite_code");
  url.searchParams.delete("code");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
}

function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function openAppUrlWithFallback(appUrl, fallback) {
  if (!isMobileBrowser()) {
    fallback();
    return;
  }

  let didLeave = false;
  const markLeave = () => {
    didLeave = true;
  };
  window.addEventListener("pagehide", markLeave, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) markLeave();
  }, { once: true });
  window.location.href = appUrl;
  window.setTimeout(() => {
    if (!didLeave) fallback();
  }, 900);
}

function formatKoreanDiaryDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}년 ${values.month}월 ${values.day}일 ${values.weekday}`;
}

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PENDING_SAVE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PENDING_SAVE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writePendingSave(value) {
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SAVE_STORE, "readwrite");
    tx.objectStore(PENDING_SAVE_STORE).put(value, PENDING_SAVE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readPendingSave() {
  const db = await openPendingDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SAVE_STORE, "readonly");
    const request = tx.objectStore(PENDING_SAVE_STORE).get(PENDING_SAVE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function clearPendingSave() {
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SAVE_STORE, "readwrite");
    tx.objectStore(PENDING_SAVE_STORE).delete(PENDING_SAVE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function getStoredImagePath(value) {
  const imageUrl = String(value || "");
  if (!imageUrl) return "";
  if (!imageUrl.startsWith("http")) return imageUrl;

  try {
    const url = new URL(imageUrl);
    const marker = "/storage/v1/object/public/diary-images/";
    const index = url.pathname.indexOf(marker);
    return index === -1 ? "" : decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function userFacingGenerateError(error) {
  const message = String(error?.message || "").trim();
  if (/로그인|세션|만료/.test(message)) return message;
  if (/OPENAI_API_KEY|API key/i.test(message)) return "그림 생성 설정을 확인해야 해요. 잠시 뒤 다시 시도해주세요.";
  if (/fetch|network|Failed to fetch/i.test(message)) return "네트워크가 잠깐 끊긴 것 같아요. 연결을 확인하고 다시 시도해주세요.";
  return message || "그림일기를 만들지 못했어요. 잠시 뒤 다시 시도해주세요.";
}

function App() {
  const initialInviteCodeRef = useRef(getInitialInviteCode());
  const [page, setPage] = useState(initialInviteCodeRef.current ? "share" : "make");
  const [supabase, setSupabase] = useState(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [kakaoJavaScriptKey, setKakaoJavaScriptKey] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [diaryBooks, setDiaryBooks] = useState([]);
  const [currentBookId, setCurrentBookId] = useState("");
  const [diaryEntries, setDiaryEntries] = useState([]);
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [form, setForm] = useState({
    diary: "",
    title: "",
    weather: "",
    textMode: "expand",
    moodType: "funny",
  });
  const [currentImageUrl, setCurrentImageUrl] = useState(sampleImage);
  const [currentImageFormat, setCurrentImageFormat] = useState("png");
  const [currentImageFilename, setCurrentImageFilename] = useState(createImageFilename("png"));
  const [lastGeneratedInput, setLastGeneratedInput] = useState(null);
  const [currentStamp, setCurrentStamp] = useState("");
  const [ritualState, setRitualState] = useState(() => getTodayRitualState());
  const [step, setStep] = useState("write");
  const [log, setLog] = useState("");
  const [logTone, setLogTone] = useState("normal");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [statusModal, setStatusModal] = useState(null);
  const [saveLoginOpen, setSaveLoginOpen] = useState(false);
  const [bookName, setBookName] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCodeRef.current);
  const restoringPendingSave = useRef(false);

  const currentBook = useMemo(
    () => diaryBooks.find((book) => book.id === currentBookId) || null,
    [diaryBooks, currentBookId],
  );
  const maxGenerations = currentUser ? MAX_DAILY_GENERATIONS : 1;
  const remaining = Math.max(0, maxGenerations - ritualState.generations);
  const isLocked = remaining <= 0;
  const hasGeneratedDataUrl = currentImageUrl.startsWith("data:");
  const loadingMessage = GENERATION_LOADING_LINES[loadingIndex % GENERATION_LOADING_LINES.length];
  const shareText = `${SHARE_LINES[ritualState.generations % SHARE_LINES.length]} ${getSharePageUrl()}`;

  function updateForm(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function pushLog(message, tone = "normal") {
    setLog(message);
    setLogTone(tone);
  }

  function syncRitualState() {
    const next = getTodayRitualState();
    writeRitualState(next);
    setRitualState({ ...next });
    return next;
  }

  async function nativeShare({ title, text, url }) {
    if (!navigator.share) return false;
    await navigator.share({ title, text, url });
    return true;
  }

  function buildRequestData() {
    return {
      ...form,
      date: formatKoreanDiaryDate(),
      referenceImageDataUrl,
      size: "1024x1536",
      quality: "medium",
      outputFormat: "png",
    };
  }

  async function getAccessToken() {
    if (!supabase) return "";
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  function setCurrentImage(url, format = "png") {
    setCurrentImageUrl(url);
    setCurrentImageFormat(format);
    setCurrentImageFilename(createImageFilename(format));
    setStep(url.startsWith("data:") ? "save" : "write");
  }

  async function withSignedImageUrls(client, entries) {
    if (!client) return entries;
    return Promise.all(entries.map(async (entry) => {
      const imagePath = entry.image_path || getStoredImagePath(entry.image_url);
      if (!imagePath) return entry;
      const { data, error } = await client.storage.from("diary-images").createSignedUrl(imagePath, 60 * 60);
      if (error) return entry;
      return { ...entry, image_url: data.signedUrl };
    }));
  }

  async function loadDiaryBooks(client = supabase, user = currentUser) {
    if (!client || !user) {
      setDiaryBooks([]);
      setCurrentBookId("");
      return [];
    }
    const { data, error } = await client
      .from("diary_books")
      .select("id, name, invite_code, owner_id, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      pushLog("서로 보기 그룹을 가져오지 못했어요.", "error");
      return [];
    }
    setDiaryBooks(data || []);
    return data || [];
  }

  async function loadDiaryEntries(client = supabase, user = currentUser, bookId = currentBookId) {
    if (!client || !user) {
      setDiaryEntries([]);
      return;
    }
    const { data, error } = await client.rpc("list_diary_entries_for_book", {
      book_id_input: bookId || null,
      limit_input: 60,
    });
    if (error) {
      setDiaryEntries([]);
      pushLog("일기장을 가져오지 못했어요.", "error");
      return;
    }
    setDiaryEntries(await withSignedImageUrls(client, data || []));
  }

  async function completeKakaoLoginFromHash(client) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kakao_login") !== "1") return false;
    const tokenResponse = await fetch("/api/kakao-session", { cache: "no-store" });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    window.history.replaceState({}, document.title, window.location.pathname);
    if (!tokenPayload.ok || !tokenPayload.idToken) {
      pushLog("로그인 연결에 실패했어요.", "error");
      return true;
    }
    const { data, error } = await client.auth.signInWithIdToken({
      provider: "kakao",
      token: tokenPayload.idToken,
    });
    if (error) {
      pushLog("로그인 처리 중 문제가 생겼어.", "error");
      return true;
    }
    setCurrentUser(data.user || null);
    return true;
  }

  async function storeCurrentImageForLoginSave() {
    if (!hasGeneratedDataUrl) return;
    await writePendingSave({
      imageUrl: currentImageUrl,
      imageFormat: currentImageFormat,
      input: lastGeneratedInput || buildRequestData(),
      stamp: currentStamp,
      bookId: currentBookId,
      createdAt: Date.now(),
    });
  }

  async function saveGeneratedDiary({
    client = supabase,
    user = currentUser,
    imageUrl = currentImageUrl,
    imageFormat = currentImageFormat,
    input = lastGeneratedInput || buildRequestData(),
    stamp = currentStamp,
    bookId = currentBookId,
  } = {}) {
    if (!client || !user) return false;
    if (!imageUrl.startsWith("data:")) return false;

    pushLog("일기장에 붙이는 중이에요...");
    const ext = imageFormat === "jpeg" ? "jpg" : imageFormat;
    const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const blob = dataUrlToBlob(imageUrl);
    const upload = await client.storage.from("diary-images").upload(path, blob, {
      contentType: blob.type,
      upsert: false,
    });
    if (upload.error) {
      pushLog("일기를 붙이지 못했어요.", "error");
      return false;
    }
    const { data: signedUrlData, error: signedUrlError } = await client.storage.from("diary-images").createSignedUrl(path, 60 * 60);
    if (signedUrlError) {
      pushLog("일기 링크를 만들지 못했어요.", "error");
      return false;
    }
    const insert = await client.from("diary_entries").insert({
      user_id: user.id,
      book_id: bookId || null,
      diary_date: input.date || getSeoulDateKey(),
      weather: input.weather || "맑음",
      title: input.title || "오늘의 일기",
      child: "초등학생",
      place: input.diary || "오늘 있었던 일",
      diary_text: input.diary || "",
      detail: stamp || input.moodType || "",
      image_url: path,
      image_path: path,
      image_format: imageFormat,
    });
    if (insert.error) {
      pushLog("일기를 저장하지 못했어요.", "error");
      return false;
    }
    setCurrentImage(signedUrlData.signedUrl, imageFormat);
    pushLog("일기장에 붙였어요.");
    setPage("book");
    await loadDiaryEntries(client, user, bookId);
    return true;
  }

  async function restorePendingSaveIfNeeded(user = currentUser, client = supabase) {
    if (restoringPendingSave.current || !user) return;
    restoringPendingSave.current = true;
    try {
      const pending = await readPendingSave();
      if (!pending?.imageUrl) return;
      setLastGeneratedInput(pending.input || null);
      setCurrentStamp(pending.stamp || "");
      setCurrentBookId(pending.bookId || "");
      setCurrentImage(pending.imageUrl, pending.imageFormat || "png");
      const saved = await saveGeneratedDiary({
        client,
        user,
        imageUrl: pending.imageUrl,
        imageFormat: pending.imageFormat || "png",
        input: pending.input || buildRequestData(),
        stamp: pending.stamp || "",
        bookId: pending.bookId || "",
      });
      if (saved) await clearPendingSave();
    } finally {
      restoringPendingSave.current = false;
    }
  }

  async function startAuth(provider, { saveAfterLogin = false } = {}) {
    if (!supabase) {
      pushLog("로그인 설정을 불러오지 못했어요.", "error");
      return;
    }
    if (saveAfterLogin) await storeCurrentImageForLoginSave();
    if (inviteCode) writePendingInviteCode(inviteCode);
    if (provider === "kakao") {
      window.location.href = "/api/kakao-login";
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) pushLog("로그인을 시작하지 못했어요.", "error");
  }

  async function handleGenerate(event) {
    event.preventDefault();
    const state = syncRitualState();
    if (Math.max(0, maxGenerations - state.generations) <= 0) {
      pushLog(currentUser ? "오늘은 여기까지예요." : "체험은 한 번만 가능해요.");
      return;
    }
    if (!form.diary.trim()) {
      pushLog("오늘 있었던 일을 한 줄만 적어주세요.", "error");
      return;
    }

    setIsGenerating(true);
    setLoadingIndex(0);
    setStep("generate");
    window.requestAnimationFrame(() => {
      document.querySelector(".result-display")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    try {
      const accessToken = await getAccessToken();
      const requestData = buildRequestData();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ ...requestData, trialGeneration: !accessToken }),
      });
      const json = await res.json().catch(() => ({
        ok: false,
        error: "응답을 읽지 못했어요. 잠시 뒤 다시 시도해주세요.",
      }));
      if (!json.ok) throw new Error(json.error || "생성 실패");
      setCurrentImage(json.image, requestData.outputFormat || "png");
      setLastGeneratedInput(requestData);
      const nextState = saveSuccessfulGeneration();
      setRitualState({ ...nextState });
      pushLog("그림일기를 만들었어요.");
    } catch (error) {
      console.error(error);
      setStep("write");
      pushLog("그림일기를 만들지 못했어요. 안내를 확인해주세요.", "error");
      setStatusModal({
        title: "그림일기를 만들지 못했어요",
        message: userFacingGenerateError(error),
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      pushLog("사진이 너무 커요. 좀 더 작은 사진으로 골라주세요.", "error");
      event.target.value = "";
      return;
    }
    setReferenceImageDataUrl(await readFileAsDataUrl(file));
    setPhotoName(file.name);
    pushLog("사진을 붙였어요.");
  }

  async function handleSaveDiary() {
    if (!hasGeneratedDataUrl) {
      pushLog("새로 만든 그림일기만 붙일 수 있어요.", "error");
      return;
    }
    if (!supabase || !currentUser) {
      await storeCurrentImageForLoginSave();
      setSaveLoginOpen(true);
      return;
    }
    await saveGeneratedDiary();
  }

  async function handleCreateBook(event) {
    event.preventDefault();
    if (!supabase || !currentUser) {
      pushLog("먼저 로그인해주세요.", "error");
      return;
    }
    const name = bookName.trim();
    if (!name) {
      pushLog("서로 보기 그룹 이름을 적어주세요.", "error");
      return;
    }
    pushLog("서로 보기 그룹을 만드는 중이에요...");
    const bookId = crypto.randomUUID();
    const bookInsert = await supabase.from("diary_books").insert({
      id: bookId,
      owner_id: currentUser.id,
      name,
      invite_code: createInviteCode(),
    });
    if (bookInsert.error) {
      pushLog("서로 보기 그룹을 만들지 못했어요.", "error");
      return;
    }
    const memberInsert = await supabase.from("diary_book_members").insert({
      book_id: bookId,
      user_id: currentUser.id,
      role: "owner",
    });
    if (memberInsert.error) {
      pushLog("일기장 멤버 등록에 실패했어요.", "error");
      return;
    }
    setBookName("");
    setCurrentBookId(bookId);
    await loadDiaryBooks();
    await loadDiaryEntries(supabase, currentUser, bookId);
    pushLog("서로 보기 그룹을 만들었어요.");
  }

  async function handleDeleteEmptyBook(book) {
    if (!supabase || !currentUser || !book) {
      pushLog("먼저 로그인해주세요.", "error");
      return;
    }
    if (book.owner_id !== currentUser.id) {
      pushLog("내가 만든 보기 그룹만 지울 수 있어요.", "error");
      return;
    }
    const confirmed = window.confirm(
      `"${book.name}" 보기 그룹을 지울까?\n초대받은 사람이나 붙인 일기가 있으면 지워지지 않아요.`
    );
    if (!confirmed) return;

    pushLog("빈 보기 그룹을 정리하는 중이에요...");
    const { data, error } = await supabase.rpc("delete_empty_diary_book", {
      book_id_input: book.id,
    });
    if (error || !data) {
      pushLog("이미 사용된 보기 그룹은 지울 수 없어요.", "error");
      return;
    }

    if (currentBookId === book.id) {
      setCurrentBookId("");
      await loadDiaryEntries(supabase, currentUser, "");
    }
    await loadDiaryBooks();
    pushLog("빈 보기 그룹을 지웠어요.");
  }

  async function acceptInviteCode(rawCode, {
    client = supabase,
    user = currentUser,
    auto = false,
  } = {}) {
    const code = normalizeInviteCode(rawCode);
    if (!code) {
      if (!auto) pushLog("초대 코드를 입력해주세요.", "error");
      return false;
    }

    setInviteCode(code);
    setPage("share");
    if (!client || !user) {
      writePendingInviteCode(code);
      if (!auto) pushLog("로그인하면 초대받은 일기장에 들어갈 수 있어요.");
      return false;
    }

    pushLog(auto ? "초대받은 일기장에 들어가는 중이에요..." : "초대 코드를 확인하는 중이에요...");
    const { data, error } = await client.rpc("join_diary_book_by_code", {
      invite_code_input: code,
    });
    if (error || !data) {
      clearPendingInviteCode();
      pushLog("초대 코드로 일기장을 찾지 못했어요.", "error");
      return false;
    }

    setInviteCode("");
    clearPendingInviteCode();
    removeInviteQueryFromUrl();
    setCurrentBookId(data);
    await loadDiaryBooks(client, user);
    await loadDiaryEntries(client, user, data);
    setPage("book");
    pushLog(auto ? "초대받은 보기 그룹에 들어왔어요." : "서로 보기 그룹에 들어왔어요.");
    return true;
  }

  async function acceptPendingInviteIfNeeded(client = supabase, user = currentUser) {
    const code = readPendingInviteCode();
    if (!code || !client || !user) return false;
    return acceptInviteCode(code, { client, user, auto: true });
  }

  async function handleJoinBook(event) {
    event.preventDefault();
    await acceptInviteCode(inviteCode);
  }

  async function handleShare(target) {
    try {
      if (target === "copy") {
        await navigator.clipboard.writeText(shareText);
        pushLog("문구를 복사했어요.");
        return;
      }
      if (target === "instagram") {
        if (!hasGeneratedDataUrl) {
          pushLog("이미지를 저장한 뒤 앱에서 공유해주세요.", "error");
          return;
        }
        const file = await createImageFileFromDataUrl(currentImageUrl, currentImageFilename);
        const data = { title: "그림일기 타임머신", text: shareText, files: [file] };
        if (navigator.canShare && navigator.canShare(data)) {
          await navigator.share(data);
          return;
        }
        pushLog("이미지를 저장한 뒤 앱에서 공유해주세요.", "error");
        return;
      }
      if (target === "x") {
        openAppUrlWithFallback(
          buildAppShareUrl("x", { text: shareText, url: getSharePageUrl() }),
          () => {
            const url = buildSocialShareUrl(target, { text: shareText, url: getSharePageUrl() });
            window.open(url, "_blank", "noopener,noreferrer,width=720,height=640");
          },
        );
      }
    } catch {
      pushLog("공유를 시작하지 못했어요.", "error");
    }
  }

  async function shareInvite(book, target) {
    if (!book) return;
    const inviteUrl = buildInviteUrl(book.invite_code);
    const shortText = `"${book.name}" 그림일기장 같이 볼래? 초대 코드: ${book.invite_code}`;
    const text = [
      `"${book.name}" 그림일기장 같이 볼래?`,
      `초대 코드: ${book.invite_code}`,
      inviteUrl,
    ].join("\n");

    const copyInvite = async () => {
      await navigator.clipboard.writeText(text);
      pushLog("초대 문구를 복사했어요.");
    };

    try {
      if (target === "copy") {
        await copyInvite();
        return;
      }

      if (target === "x") {
        openAppUrlWithFallback(
          buildAppShareUrl("x", { text: shortText, url: inviteUrl }),
          () => {
            const url = buildSocialShareUrl("x", { text: shortText, url: inviteUrl });
            window.open(url, "_blank", "noopener,noreferrer,width=720,height=640");
          },
        );
        return;
      }

      if (target === "kakao") {
        if (kakaoJavaScriptKey) {
          await shareKakaoInvite({
            javaScriptKey: kakaoJavaScriptKey,
            title: book.name,
            text: shortText,
            url: inviteUrl,
          });
          return;
        }
        if (await nativeShare({ title: `${book.name} 그림일기장`, text, url: inviteUrl })) return;
        await copyInvite();
        return;
      }

      if (target === "instagram") {
        if (await nativeShare({ title: `${book.name} 그림일기장`, text, url: inviteUrl })) return;
        await copyInvite();
        return;
      }

      openAppUrlWithFallback(
        buildAppShareUrl(target, { text: shortText, url: inviteUrl }),
        copyInvite,
      );
    } catch {
      await navigator.clipboard.writeText(text).catch(() => {});
      pushLog("초대 문구를 복사했어요.");
    }
  }

  useEffect(() => {
    syncRitualState();
    let unsubscribe = null;
    (async () => {
      const config = await getSupabaseConfig();
      setAuthConfigured(config.configured);
      setKakaoJavaScriptKey(config.kakaoJavaScriptKey || "");
      if (!config.configured) {
        setDiaryEntries([]);
        return;
      }
      const client = await getSupabaseClient();
      setSupabase(client);
      const completedKakaoLogin = await completeKakaoLoginFromHash(client);
      const { data } = await client.auth.getUser().catch(() => ({ data: { user: null } }));
      const user = data.user || null;
      setCurrentUser(user);
      const params = new URLSearchParams(window.location.search);
      const authError = params.get("error_description") || params.get("error");
      if (!completedKakaoLogin && authError) pushLog("로그인 중에 문제가 생겼어.", "error");
      if (authError) window.history.replaceState({}, document.title, window.location.pathname);
      const inviteFromUrl = getInviteCodeFromUrl(window.location);
      if (inviteFromUrl) {
        writePendingInviteCode(inviteFromUrl);
        setInviteCode(inviteFromUrl);
        setPage("share");
        removeInviteQueryFromUrl();
      }
      await loadDiaryBooks(client, user);
      const acceptedInvite = user ? await acceptPendingInviteIfNeeded(client, user) : false;
      if (!acceptedInvite) await loadDiaryEntries(client, user, "");
      if (user) await restorePendingSaveIfNeeded(user, client);
      const listener = client.auth.onAuthStateChange(async (_event, session) => {
        const nextUser = session?.user || null;
        setCurrentUser(nextUser);
        await loadDiaryBooks(client, nextUser);
        const acceptedNextInvite = nextUser ? await acceptPendingInviteIfNeeded(client, nextUser) : false;
        if (!acceptedNextInvite) await loadDiaryEntries(client, nextUser, "");
        if (nextUser) await restorePendingSaveIfNeeded(nextUser, client);
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    })();
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!isGenerating) return undefined;
    const timer = window.setInterval(() => setLoadingIndex((value) => value + 1), 2200);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    if (!supabase || !currentUser) return;
    loadDiaryEntries(supabase, currentUser, currentBookId);
  }, [currentBookId]);

  const providerLabel = currentUser?.user_metadata?.full_name || "학생";

  return (
    <>
      <aside className="sidebar app-sidebar">
        <button type="button" className="sidebar__logo logo-button" onClick={() => setPage("make")}>그림일기장</button>
        <nav className="nav" aria-label="주요 메뉴">
          <button type="button" className={`nav__item ${page === "make" ? "active" : ""}`} onClick={() => setPage("make")}>만들기</button>
          <button type="button" className={`nav__item ${page === "book" ? "active" : ""}`} onClick={() => setPage("book")}>내 일기장</button>
          <button type="button" className={`nav__item ${page === "share" ? "active" : ""}`} onClick={() => setPage("share")}>서로 일기 보기</button>
        </nav>
      </aside>

      <main className="main app-main">
        <div className="content-wrapper">
          <header className="top-bar">
            <nav className="page-tabs" aria-label="페이지 이동">
              {[
                ["make", "만들기"],
                ["book", "일기장"],
                ["share", "서로 보기"],
              ].map(([key, label]) => (
                <button key={key} type="button" className={page === key ? "active" : ""} onClick={() => setPage(key)}>{label}</button>
              ))}
            </nav>
            {currentUser ? (
              <div className="user-menu">
                <div className="auth-badge">{providerLabel}님</div>
                <button type="button" className="btn btn--ghost mini" onClick={async () => {
                  await supabase?.auth.signOut();
                  setCurrentUser(null);
                  setDiaryEntries([]);
                  setDiaryBooks([]);
                }}>로그아웃</button>
              </div>
            ) : null}
          </header>

          {page === "make" ? (
            <MakePage
              form={form}
              updateForm={updateForm}
              isLocked={isLocked}
              remaining={remaining}
              ritualState={ritualState}
              currentUser={currentUser}
              step={step}
              currentImageUrl={currentImageUrl}
              currentImageFilename={currentImageFilename}
              loadingMessage={loadingMessage}
              isGenerating={isGenerating}
              photoName={photoName}
              referenceImageDataUrl={referenceImageDataUrl}
              setReferenceImageDataUrl={setReferenceImageDataUrl}
              setPhotoName={setPhotoName}
              currentStamp={currentStamp}
              setCurrentStamp={setCurrentStamp}
              currentBook={currentBook}
              isSampleImage={currentImageUrl === sampleImage}
              onGenerate={handleGenerate}
              onPhotoChange={handlePhotoChange}
              onSave={handleSaveDiary}
              onShare={handleShare}
            />
          ) : null}

          {page === "book" ? (
            <BookPage
              currentUser={currentUser}
              authConfigured={authConfigured}
              entries={diaryEntries}
              books={diaryBooks}
              currentBookId={currentBookId}
              setCurrentBookId={setCurrentBookId}
              onOpenEntry={(entry) => {
                setCurrentImage(entry.image_url, entry.image_format || "png");
                pushLog(`${entry.diary_date || "이전"} 일기를 펼쳤어요.`);
                setPage("make");
              }}
              onRefresh={() => loadDiaryEntries()}
              onStartAuth={startAuth}
            />
          ) : null}

          {page === "share" ? (
            <SharePage
              currentUser={currentUser}
              authConfigured={authConfigured}
              books={diaryBooks}
              currentBook={currentBook}
              bookName={bookName}
              setBookName={setBookName}
              inviteCode={inviteCode}
              setInviteCode={setInviteCode}
              onCreateBook={handleCreateBook}
              onJoinBook={handleJoinBook}
              onStartAuth={startAuth}
              onOpenBook={(bookId) => {
                setCurrentBookId(bookId);
                setPage("book");
              }}
              onShareInvite={shareInvite}
              onDeleteBook={handleDeleteEmptyBook}
            />
          ) : null}

          <div id="log" data-tone={logTone}>{log}</div>
        </div>
      </main>

      {saveLoginOpen ? (
        <AuthModal
          title="일기장에 붙일까요?"
          description="계정에 붙이면 나중에 다시 볼 수 있어요."
          onClose={() => setSaveLoginOpen(false)}
          onStartAuth={(provider) => startAuth(provider, { saveAfterLogin: true })}
        />
      ) : null}

      {statusModal ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="statusModalTitle" onClick={(event) => {
          if (event.target === event.currentTarget) setStatusModal(null);
        }}>
          <div className="modal__panel">
            <button type="button" className="modal__close" onClick={() => setStatusModal(null)} aria-label="닫기">×</button>
            <h2 id="statusModalTitle">{statusModal.title}</h2>
            <p>{statusModal.message}</p>
            <button type="button" className="btn btn--primary" onClick={() => setStatusModal(null)}>확인</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MakePage({
  form,
  updateForm,
  isLocked,
  remaining,
  ritualState,
  currentUser,
  step,
  currentImageUrl,
  currentImageFilename,
  loadingMessage,
  isGenerating,
  photoName,
  referenceImageDataUrl,
  setReferenceImageDataUrl,
  setPhotoName,
  currentStamp,
  setCurrentStamp,
  currentBook,
  isSampleImage,
  onGenerate,
  onPhotoChange,
  onSave,
  onShare,
}) {
  const hasUsedFirst = ritualState.generations > 0;
  const quota = !currentUser
    ? {
        title: remaining > 0 ? "체험으로 한 장 만들기" : "체험 완료",
        text: remaining > 0 ? "먼저 한 장 만들어볼 수 있어요." : "더 만들려면 일기장에 붙여주세요.",
        status: remaining > 0 ? "1번 가능" : "완료",
      }
    : ritualState.generations === 0
      ? { title: "오늘의 일기장", text: "오늘은 두 장까지 만들 수 있어요.", status: "2번 가능" }
      : ritualState.generations === 1
        ? { title: "지우개 찬스!", text: "한 번 더 만들 수 있어요.", status: "1번 가능" }
        : { title: "오늘은 여기까지", text: "내일 다시 만들 수 있어요.", status: "완료" };
  const placeholder = form.textMode === "exact"
    ? "예: 오늘은 회사에서 일이 많았다.\n집에 오면서 라면을 먹었다.\n조금 피곤했지만 맛있었다."
    : "한 줄만 적어도 알아서 일기장 문장으로 만들어줄게요.";

  return (
    <section className="page-stack make-page">
      <section className="page-header compact-hero">
        <div className="profile">
          <div className="avatar"><img src="/main.png" alt="Profile" /></div>
          <h1 className="brand-name">그림일기</h1>
        </div>
      </section>

      <div className="grid">
        <section className="workspace">
          <form className="card" onSubmit={onGenerate}>
            <h2>오늘 뭐 했나요?</h2>
            <ol className="step-list" aria-label="그림일기 진행 순서">
              <li className={`step-list__item ${step === "write" ? "active" : ""}`}><span>1</span>쓰기</li>
              <li className={`step-list__item ${step === "generate" ? "active" : ""}`}><span>2</span>그리기</li>
              <li className={`step-list__item ${step === "save" ? "active" : ""}`}><span>3</span>붙이기</li>
            </ol>

            <div className="quota-card" data-state={!currentUser ? "login" : isLocked ? "locked" : hasUsedFirst ? "eraser" : "ready"}>
              <div>
                <strong>{quota.title}</strong>
                <p>{quota.text}</p>
              </div>
              <span className="quota-card__status">{quota.status}</span>
            </div>

            <div className="field">
              <label className="field__label">오늘 있었던 일</label>
              <div className="text-mode-group" aria-label="일기 문구 방식">
                <RadioPill name="textMode" value="expand" checked={form.textMode === "expand"} disabled={isLocked} onChange={updateForm}>일기 쓰기 귀찮은데...</RadioPill>
                <RadioPill name="textMode" value="exact" checked={form.textMode === "exact"} disabled={isLocked} onChange={updateForm}>내 문구 그대로</RadioPill>
              </div>
              <textarea
                name="diary"
                rows="5"
                placeholder={placeholder}
                value={form.diary}
                disabled={isLocked}
                onChange={(event) => updateForm("diary", event.target.value)}
                required
              />
            </div>

            <details className="optional-diary-fields">
              <summary>제목이랑 날씨도 직접 정할래요 <span>선택</span></summary>
              <div className="optional-diary-fields__grid">
                <label className="field compact-field">
                  <span className="field__label">제목 <em>선택</em></span>
                  <input type="text" value={form.title} disabled={isLocked} maxLength="40" placeholder="비워두면 어울리게 적어줘요." onChange={(event) => updateForm("title", event.target.value)} />
                </label>
                <label className="field compact-field">
                  <span className="field__label">날씨 <em>선택</em></span>
                  <input type="text" value={form.weather} disabled={isLocked} maxLength="20" placeholder="예: 맑음, 흐림, 비" onChange={(event) => updateForm("weather", event.target.value)} />
                </label>
              </div>
            </details>

            <div className="field">
              <label className="field__label">그날의 사진 <em>없어도 돼요</em></label>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={isLocked} onChange={onPhotoChange} />
            </div>

            {referenceImageDataUrl ? (
              <div className="preview-box">
                <img src={referenceImageDataUrl} alt="미리보기" />
                <button type="button" className="btn--ghost" onClick={() => {
                  setReferenceImageDataUrl("");
                  setPhotoName("");
                }}>빼기</button>
                <span>{photoName}</span>
              </div>
            ) : null}

            <div className="field">
              <label className="field__label">오늘의 분위기</label>
              <div className="mood-group">
                <RadioPill name="moodType" value="funny" checked={form.moodType === "funny"} disabled={isLocked} onChange={updateForm}>웃긴 일기</RadioPill>
                <RadioPill name="moodType" value="soft" checked={form.moodType === "soft"} disabled={isLocked} onChange={updateForm}>찡한 일기</RadioPill>
                <RadioPill name="moodType" value="kid" checked={form.moodType === "kid"} disabled={isLocked} onChange={updateForm}>진짜 초딩 일기</RadioPill>
              </div>
            </div>

            <div className="actions">
              <button type="submit" className="btn btn--primary" disabled={isLocked || isGenerating}>
                {hasUsedFirst ? "다시 만들기" : "그림일기 만들기"}
              </button>
              {hasUsedFirst && !isLocked ? (
                <button type="submit" className="btn btn--ghost">마음에 안 들어! 다시 쓸래</button>
              ) : null}
            </div>
          </form>
        </section>

        <ResultPanel
          currentImageUrl={currentImageUrl}
          currentImageFilename={currentImageFilename}
          loadingMessage={loadingMessage}
          isGenerating={isGenerating}
          onSave={onSave}
          onShare={onShare}
          currentStamp={currentStamp}
          setCurrentStamp={setCurrentStamp}
          saveHint={currentImageUrl.startsWith("data:")
            ? currentBook ? `"${currentBook.name}"에 붙일 준비가 됐어요.` : "일기장에 붙일 준비가 됐어요."
            : "아직 붙일 그림일기가 없어요."}
          streakTitle={getStreakReward(ritualState.streak)}
          streakText={ritualState.streak ? `${ritualState.streak}일째 일기장을 채우는 중이에요.` : "오늘 한 장을 내면 기록이 시작돼요."}
          isSampleImage={isSampleImage}
        />
      </div>
    </section>
  );
}

function RadioPill({ name, value, checked, disabled, onChange, children }) {
  return (
    <label>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(name, value)} />
      <span>{children}</span>
    </label>
  );
}

function ShareTargetIcon({ target }) {
  if (target === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.1 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.7a4.9 4.9 0 0 1-2.1 3.2v2.6H19c2-1.8 3.1-4.4 3.1-7.5Z" />
        <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 7-2.5l-3.4-2.6c-.9.6-2.1 1-3.6 1-2.8 0-5.1-1.9-5.9-4.4H2.6v2.7A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.1 13.5a6 6 0 0 1 0-3.1V7.7H2.6a10 10 0 0 0 0 8.9l3.5-3.1Z" />
        <path fill="#EA4335" d="M12 6.1c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 2.6 7.7l3.5 2.7C6.9 7.9 9.2 6.1 12 6.1Z" />
      </svg>
    );
  }
  if (target === "kakao") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4C6.9 4 3 7.1 3 11c0 2.5 1.6 4.7 4 5.9l-.7 2.8 3.3-1.9c.8.1 1.6.2 2.4.2 5.1 0 9-3.1 9-7s-3.9-7-9-7Z" />
      </svg>
    );
  }
  if (target === "naver") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.4 12.5 8.4 2H2v20h6.6V11.5l7 10.5H22V2h-6.6v10.5Z" />
      </svg>
    );
  }
  if (target === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
        <path d="M6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
      </svg>
    );
  }
  if (target === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.3 10.5 21.8 2h-1.9l-6.5 7.4L8.2 2H2.2l7.9 11.2L2.2 22h1.9l6.8-7.7 5.5 7.7h5.9l-8-11.5Zm-2.4 2.7-.8-1.1L4.7 3.4h2.6l5.1 7.1.8 1.1 6.7 9.1h-2.6l-5.4-7.5Z" />
      </svg>
    );
  }
  if (target === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="3.5" />
        <circle cx="17" cy="7" r="1.1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function IconShareButton({ target, label, disabled = false, onClick }) {
  return (
    <button type="button" className={`icon-share-button icon-share-button--${target}`} disabled={disabled} onClick={onClick} aria-label={label} title={label}>
      <ShareTargetIcon target={target} />
    </button>
  );
}

function AuthProviderButton({ target, label, onClick }) {
  return (
    <button type="button" className={`auth-provider-button auth-provider-button--${target}`} onClick={onClick} aria-label={`${label} 로그인`} title={`${label} 로그인`}>
      <ShareTargetIcon target={target} />
      <span>{label}</span>
    </button>
  );
}

function ResultPanel({
  currentImageUrl,
  currentImageFilename,
  loadingMessage,
  isGenerating,
  onSave,
  onShare,
  currentStamp,
  setCurrentStamp,
  saveHint,
  streakTitle,
  streakText,
  isSampleImage,
}) {
  return (
    <section className="result">
      <div className="card">
        <h2>오늘의 일기</h2>
        <div className="result-display">
          <img src={currentImageUrl} alt="생성 결과" />
          {isSampleImage ? <span className="sample-badge">샘플</span> : null}
          {isGenerating ? (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <p>{loadingMessage}</p>
              <small>보통 1분에서 1분 30초 정도 걸려요.</small>
            </div>
          ) : null}
        </div>
        <div className="btn-group">
          <a className="btn btn--ghost" href={currentImageUrl} download={currentImageFilename}>일기 가져가기</a>
          <button type="button" className="btn btn--primary" onClick={onSave} style={{ flex: 1 }}>일기장에 붙이기</button>
        </div>
        <p className="save-hint">{saveHint}</p>
        <div className="stamps">
          {["참 잘했어요", "재밌었음", "일기 완료"].map((stamp) => (
            <button key={stamp} type="button" className={`stamp ${currentStamp === stamp ? "selected" : ""}`} onClick={() => setCurrentStamp(stamp)}>{stamp}</button>
          ))}
        </div>
        <div className="shares">
          <IconShareButton target="x" label="X로 공유" onClick={() => onShare("x")} />
          <IconShareButton target="instagram" label="Instagram으로 공유" onClick={() => onShare("instagram")} />
          <IconShareButton target="copy" label="링크 복사" onClick={() => onShare("copy")} />
        </div>
        <div className="streak-card">
          <strong>{streakTitle}</strong>
          <p>{streakText}</p>
        </div>
      </div>
    </section>
  );
}

function BookPage({ currentUser, authConfigured, entries, books, currentBookId, setCurrentBookId, onOpenEntry, onRefresh, onStartAuth }) {
  const showAuthor = Boolean(currentBookId);

  return (
    <section className="page-stack">
      <div className="section-heading compact-heading">
        <h2>내 그림일기장</h2>
        <select value={currentBookId} onChange={(event) => setCurrentBookId(event.target.value)} disabled={!currentUser}>
          <option value="">나만 보기</option>
          {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
        </select>
      </div>
      {!currentUser ? (
        <AuthPanel authConfigured={authConfigured} onStartAuth={onStartAuth} />
      ) : entries.length ? (
        <div className="diary-list">
          {entries.map((entry) => (
            <article className="diary-entry" key={entry.id}>
              <button type="button" className="diary-entry__image" onClick={() => onOpenEntry(entry)}>
                <img src={entry.image_url} alt={entry.title || "그림일기"} loading="lazy" />
              </button>
              <div className="diary-entry__body">
                <div className="diary-entry__meta">
                  {showAuthor && entry.author_name ? `${entry.author_name} · ` : ""}
                  {entry.diary_date || "날짜 없음"}
                </div>
                <h3>{entry.title || "오늘의 일기"}</h3>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">아직 모은 일기가 없어.</div>
      )}
      <button type="button" className="btn btn--ghost mini" onClick={onRefresh}>일기장 들춰보기</button>
    </section>
  );
}

function SharePage({
  currentUser,
  authConfigured,
  books,
  currentBook,
  bookName,
  setBookName,
  inviteCode,
  setInviteCode,
  onCreateBook,
  onJoinBook,
  onStartAuth,
  onOpenBook,
  onShareInvite,
  onDeleteBook,
}) {
  return (
    <section className="page-stack">
      <div className="card classroom">
        <h2>서로 일기 보기</h2>
        <p>초대 링크로 연결된 사람끼리 각자 만든 그림일기를 볼 수 있어요.</p>
        {!currentUser ? (
          <div className="share-layout">
            {inviteCode ? (
              <div className="invite-card pending-invite">
                <div>
                  <span className="invite-card__label">받은 초대 코드</span>
                  <strong className="invite-card__code">{inviteCode}</strong>
                  <p>로그인하면 이 일기장에 바로 들어가요.</p>
                </div>
              </div>
            ) : null}
            <AuthPanel authConfigured={authConfigured} onStartAuth={onStartAuth} />
          </div>
        ) : (
          <div className="share-layout">
            {books.length ? (
              <div className="shared-book-list">
                {books.map((book) => (
                  <details className={`shared-book-card ${currentBook?.id === book.id ? "selected" : ""}`} key={book.id}>
                    <summary>
                      <span>
                        <strong>{book.name}</strong>
                        <small>{currentBook?.id === book.id ? "지금 보는 그룹" : "서로 보기 그룹"}</small>
                      </span>
                      <span className="shared-book-card__summary-actions">
                        <button type="button" className="btn btn--ghost mini" onClick={(event) => {
                          event.preventDefault();
                          onOpenBook(book.id);
                        }}>일기 보기</button>
                        <span className="share-pill mini">초대</span>
                      </span>
                    </summary>
                    <div className="shared-book-card__expanded">
                      <div className="invite-actions invite-actions--inline" aria-label={`${book.name} 초대 공유`}>
                        <IconShareButton target="kakao" label={`${book.name} 카카오톡 초대`} onClick={() => onShareInvite(book, "kakao")} />
                        <IconShareButton target="x" label={`${book.name} X 초대`} onClick={() => onShareInvite(book, "x")} />
                        <IconShareButton target="instagram" label={`${book.name} Instagram 초대`} onClick={() => onShareInvite(book, "instagram")} />
                        <IconShareButton target="copy" label={`${book.name} 초대 링크 복사`} onClick={() => onShareInvite(book, "copy")} />
                      </div>
                      {book.owner_id === currentUser?.id ? (
                        <IconShareButton target="trash" label={`${book.name} 빈 그룹 지우기`} onClick={() => onDeleteBook(book)} />
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="empty-state">서로 보기 그룹을 만들거나 초대 링크로 들어오면 여기에 보여.</div>
            )}

            <details className="share-step-card">
              <summary>
                <span className="share-step-card__badge">+</span>
                <span>
                  <strong>새 서로 보기 그룹 만들기</strong>
                  <small>필요할 때만 새로 만들어요.</small>
                </span>
              </summary>
              <div className="share-step-card__body">
                  <form className="book-inline-form" onSubmit={onCreateBook}>
                    <input type="text" value={bookName} maxLength="30" placeholder="예: 우리 가족 그림일기" onChange={(event) => setBookName(event.target.value)} />
                    <button type="submit" className="btn btn--primary mini">그룹 만들기</button>
                  </form>
              </div>
            </details>

            <details className="share-step-card" open={Boolean(inviteCode)}>
              <summary>
                <span className="share-step-card__badge">↗</span>
                <span>
                  <strong>초대 코드로 들어가기</strong>
                  <small>링크로 받은 코드는 자동으로 채워져요.</small>
                </span>
              </summary>
              <div className="share-step-card__body">
                  <form className="book-inline-form" onSubmit={onJoinBook}>
                    <input type="text" value={inviteCode} maxLength="12" placeholder="초대 코드" onChange={(event) => setInviteCode(normalizeInviteCode(event.target.value))} />
                    <button type="submit" className="btn btn--primary mini">들어가기</button>
                  </form>
              </div>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}

function AuthPanel({ authConfigured, onStartAuth }) {
  return (
    <div className="auth-card" data-state={authConfigured ? "ready" : "unavailable"}>
      <div className="auth-card__header">
        <span className="auth-card__step">1</span>
        <div>
          <strong>{authConfigured ? "로그인하면 일기장을 쓸 수 있어요." : "로그인 설정을 불러오지 못했어요."}</strong>
          <p>{authConfigured ? "만든 그림일기를 저장하고 서로 볼 사람을 초대할 수 있어요." : "체험 생성은 가능하지만 저장은 사용할 수 없어요."}</p>
        </div>
      </div>
      {authConfigured ? (
        <div className="auth-actions">
          <AuthProviderButton target="google" label="Google" onClick={() => onStartAuth("google")} />
          <AuthProviderButton target="kakao" label="Kakao" onClick={() => onStartAuth("kakao")} />
          <AuthProviderButton target="naver" label="Naver" onClick={() => onStartAuth("custom:naver")} />
        </div>
      ) : null}
    </div>
  );
}

function AuthModal({ title, description, onClose, onStartAuth }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="saveLoginTitle" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal__panel">
        <button type="button" className="modal__close" onClick={onClose} aria-label="닫기">×</button>
        <h2 id="saveLoginTitle">{title}</h2>
        <p>{description}</p>
        <div className="auth-actions">
          <AuthProviderButton target="google" label="Google" onClick={() => onStartAuth("google")} />
          <AuthProviderButton target="kakao" label="Kakao" onClick={() => onStartAuth("kakao")} />
          <AuthProviderButton target="naver" label="Naver" onClick={() => onStartAuth("custom:naver")} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

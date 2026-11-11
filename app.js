"use strict";

const $ = (selector) => document.querySelector(selector);
const elements = {
  brandName: $("#brandName"),
  partnerName: $("#partnerName"),
  connectionDot: $("#connectionDot"),
  connectionText: $("#connectionText"),
  stageStatus: $("#stageStatus"),
  coreWrap: $("#coreWrap"),
  caption: $("#caption"),
  fileCount: $("#fileCount"),
  fileList: $("#fileList"),
  messages: $("#messages"),
  composer: $("#composer"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendButton"),
  micButton: $("#micButton"),
  micLabel: $("#micLabel"),
  stopVoiceButton: $("#stopVoiceButton"),
  voiceSupport: $("#voiceSupport"),
  settingsButton: $("#settingsButton"),
  closeSettingsButton: $("#closeSettingsButton"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  apiKeyInput: $("#apiKeyInput"),
  elevenApiKeyInput: $("#elevenApiKeyInput"),
  elevenVoiceIdInput: $("#elevenVoiceIdInput"),
  elevenVoiceIdManualInput: $("#elevenVoiceIdManualInput"),
  elevenModelSelect: $("#elevenModelSelect"),
  loadElevenVoicesButton: $("#loadElevenVoicesButton"),
  testElevenVoiceButton: $("#testElevenVoiceButton"),
  elevenStatus: $("#elevenStatus"),
  ownerNameInput: $("#ownerNameInput"),
  partnerNameInput: $("#partnerNameInput"),
  toneInput: $("#toneInput"),
  autoSpeakInput: $("#autoSpeakInput"),
  handsFreeInput: $("#handsFreeInput"),
  voiceSelect: $("#voiceSelect"),
  reloadButton: $("#reloadButton"),
  clearButton: $("#clearButton")
};

const DEFAULT_SETTINGS = {
  ownerName: "社長",
  partnerName: "AI相棒",
  tone: "自然で親しみがあり、長く付き合っている仕事仲間のように",
  autoSpeak: true,
  handsFree: true,
  voiceURI: "",
  elevenVoiceId: "",
  elevenModel: "eleven_multilingual_v2"
};

let apiKey = "";
let elevenApiKey = "";
let settings = loadSettings();
let messages = [];
let busy = false;
let recognition = null;
let listening = false;
let recognitionFinalSent = false;
let voices = [];
let conversationActive = false;
let speaking = false;
let restartTimer = null;
let ttsController = null;
let activeSpeechStop = null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("aiPartnerSettings") || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem("aiPartnerSettings", JSON.stringify(settings));
}

function setConnection(type, text) {
  elements.connectionDot.className = type;
  elements.connectionText.textContent = text;
}

function setStage(state, caption) {
  elements.coreWrap.className = `core-wrap ${state || ""}`.trim();
  elements.stageStatus.textContent = ({ listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING" })[state] || "STANDBY";
  if (caption) elements.caption.textContent = caption;
}

function updateMicUi() {
  if (!recognition) return;
  if (settings.handsFree) {
    elements.micLabel.textContent = conversationActive ? "会話を終了" : "会話を始める";
    elements.micButton.classList.toggle("active", conversationActive);
  } else {
    elements.micLabel.textContent = listening ? "聞いています" : "話す";
    elements.micButton.classList.toggle("active", listening);
  }
}

function applySettingsToUi() {
  elements.ownerNameInput.value = settings.ownerName;
  elements.partnerNameInput.value = settings.partnerName;
  elements.toneInput.value = settings.tone;
  elements.autoSpeakInput.checked = settings.autoSpeak;
  elements.handsFreeInput.checked = settings.handsFree;
  if (settings.elevenVoiceId) {
    const exists = [...elements.elevenVoiceIdInput.options].some((option) => option.value === settings.elevenVoiceId);
    if (!exists) {
      const saved = document.createElement("option");
      saved.value = settings.elevenVoiceId;
      saved.textContent = `保存済みの声（${settings.elevenVoiceId.slice(0, 8)}…）`;
      elements.elevenVoiceIdInput.append(saved);
    }
  }
  elements.elevenVoiceIdInput.value = settings.elevenVoiceId;
  elements.elevenVoiceIdManualInput.value = settings.elevenVoiceId;
  elements.elevenModelSelect.value = settings.elevenModel;
  elements.brandName.textContent = settings.partnerName;
  elements.partnerName.textContent = settings.partnerName;
  updateMicUi();
}

function addMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const name = document.createElement("span");
  name.textContent = role === "user" ? settings.ownerName : settings.partnerName;
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  article.append(name, paragraph);
  elements.messages.append(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function loadKnowledge() {
  elements.fileList.innerHTML = '<li class="muted">確認しています…</li>';
  try {
    const response = await fetch("/api/knowledge", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "情報を読み込めませんでした。");
    elements.fileCount.textContent = String(data.files.length).padStart(2, "0");
    elements.fileList.innerHTML = "";
    if (!data.files.length) {
      elements.fileList.innerHTML = '<li class="muted">情報ファイルがありません</li>';
    } else {
      data.files.forEach((file) => {
        const li = document.createElement("li");
        li.textContent = file.name;
        li.title = file.name;
        elements.fileList.append(li);
      });
    }
    setConnection("ready", "接続済み");
  } catch (error) {
    elements.fileCount.textContent = "--";
    elements.fileList.innerHTML = `<li class="muted">${escapeHtml(error.message)}</li>`;
    setConnection("error", "確認が必要");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function cleanForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "コードは画面に表示しています。")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/[*_~`>#|]/g, "")
    .replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{2,}/g, "。")
    .replace(/\n/g, "、")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cancelRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
}

function scheduleListening(delay = 350) {
  cancelRestart();
  if (!conversationActive || !settings.handsFree) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startRecognition();
  }, delay);
}

function startRecognition() {
  if (!recognition || listening || busy || speaking || !conversationActive && settings.handsFree) return;
  elements.voiceSupport.textContent = "";
  recognitionFinalSent = false;
  try { recognition.start(); } catch { /* already starting */ }
}

function stopRecognition() {
  cancelRestart();
  if (!recognition || !listening) return;
  try { recognition.abort(); } catch { /* ignore */ }
}

async function sendMessage(text) {
  const clean = String(text || "").trim();
  if (!clean || busy) return;
  if (!apiKey) {
    setStage("", "最初に設定からClaude APIキーを入力してください。");
    elements.settingsDialog.showModal();
    elements.apiKeyInput.focus();
    return;
  }

  stopSpeaking({ quiet: true });
  if (listening) {
    try { recognition.stop(); } catch { /* ignore */ }
  }

  messages.push({ role: "user", content: clean });
  messages = messages.slice(-12);
  addMessage("user", clean);
  elements.messageInput.value = "";
  busy = true;
  elements.sendButton.disabled = true;
  setStage("thinking", "考えています…");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey, settings, messages })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "回答を受け取れませんでした。");
    messages.push({ role: "assistant", content: data.text });
    messages = messages.slice(-12);
    addMessage("assistant", data.text);
    setStage("", data.text);
    if (settings.autoSpeak) await speak(data.text);
  } catch (error) {
    const message = error.message || "接続を確認してください。";
    addMessage("assistant", `エラー：${message}`);
    setStage("", message);
    setConnection("error", "確認が必要");
  } finally {
    busy = false;
    elements.sendButton.disabled = false;
    if (!settings.handsFree) elements.messageInput.focus();
    if (conversationActive && settings.handsFree) scheduleListening(250);
  }
}

function populateVoices() {
  voices = window.speechSynthesis?.getVoices?.() || [];
  const japanese = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("ja"));
  const list = japanese.length ? japanese : voices;
  elements.voiceSelect.innerHTML = '<option value="">端末の標準音声</option>';
  list.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name}（${voice.lang}）`;
    option.selected = settings.voiceURI === voice.voiceURI;
    elements.voiceSelect.append(option);
  });
}

async function loadElevenVoices() {
  elevenApiKey = elements.elevenApiKeyInput.value.trim();
  if (!elevenApiKey) {
    elements.elevenStatus.textContent = "先にElevenLabs APIキーを入力してください。";
    elements.elevenApiKeyInput.focus();
    return;
  }
  elements.loadElevenVoicesButton.disabled = true;
  elements.elevenStatus.textContent = "音声一覧を取得しています…";
  try {
    const response = await fetch("/api/voices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: elevenApiKey })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "音声一覧を取得できませんでした。");
    const previous = elements.elevenVoiceIdInput.value || settings.elevenVoiceId;
    elements.elevenVoiceIdInput.innerHTML = "";
    if (!data.voices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "利用できる音声が見つかりません";
      elements.elevenVoiceIdInput.append(option);
      elements.elevenStatus.textContent = "音声が0件です。2026年3月以降の新規アカウントは従来のDefault voicesが最初から使えません。ElevenLabsの「Voices → Explore」で日本語の声を選び、＋でMy Voicesへ保存してからもう一度読み込んでください。";
      return;
    }
    data.voices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.voice_id;
      const language = voice.labels?.language || voice.labels?.accent || voice.category || "";
      option.textContent = language ? `${voice.name} — ${language}` : voice.name;
      elements.elevenVoiceIdInput.append(option);
    });
    const stillExists = [...elements.elevenVoiceIdInput.options].some((option) => option.value === previous);
    elements.elevenVoiceIdInput.value = stillExists ? previous : data.voices[0].voice_id;
    elements.elevenVoiceIdManualInput.value = elements.elevenVoiceIdInput.value;
    elements.elevenStatus.textContent = `${data.voices.length}件の音声を取得しました。「声を選ぶ」から選択できます。日本語イントネーションは、日本語で収録された声を選ぶと改善しやすいです。`;
  } catch (error) {
    const message = String(error.message || "");
    if (/401|403|permission|unauthorized|forbidden/i.test(message)) {
      elements.elevenStatus.textContent = `${message} APIキーの権限で「Voices: Read」と「Text to Speech」を許可しているか確認してください。`;
    } else {
      elements.elevenStatus.textContent = `${message} ElevenLabsのAPIキーと通信状態を確認してください。`;
    }
  } finally {
    elements.loadElevenVoicesButton.disabled = false;
  }
}

async function speak(text) {
  const spokenText = cleanForSpeech(text);
  if (!spokenText) return;
  stopSpeaking({ quiet: true });
  speaking = true;
  setStage("speaking", text);

  try {
    if (elevenApiKey && settings.elevenVoiceId) {
      try {
        await speakEleven(spokenText);
        elements.voiceSupport.textContent = "選択したElevenLabs音声で会話中";
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
        elements.voiceSupport.textContent = `ElevenLabs音声エラー：${error.message}`;
        setStage("", `ElevenLabs音声エラー：${error.message}`);
        return;
      }
    }
    await speakSystem(spokenText);
  } finally {
    speaking = false;
    activeSpeechStop = null;
    ttsController = null;
    if (!conversationActive || !settings.handsFree) setStage("", text);
  }
}

async function speakEleven(text) {
  ttsController = new AbortController();
  const response = await fetch("/api/tts", {
    method: "POST",
    signal: ttsController.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiKey: elevenApiKey,
      voiceId: settings.elevenVoiceId,
      modelId: settings.elevenModel,
      languageCode: "ja",
      text
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `音声生成に失敗しました（${response.status}）。`);
  }
  const blob = await response.blob();
  if (ttsController.signal.aborted) throw new DOMException("Aborted", "AbortError");

  await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      activeSpeechStop = null;
      if (error) reject(error);
      else resolve();
    };
    activeSpeechStop = () => {
      audio.pause();
      audio.currentTime = 0;
      done();
    };
    audio.onended = () => done();
    audio.onerror = () => done(new Error("生成した音声を再生できませんでした。"));
    audio.play().catch((error) => done(error));
  });
}

async function speakSystem(text) {
  if (!("speechSynthesis" in window)) return;
  await new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      activeSpeechStop = null;
      resolve();
    };
    utterance.lang = "ja-JP";
    utterance.rate = 1.04;
    utterance.pitch = 0.96;
    const selected = voices.find((voice) => voice.voiceURI === settings.voiceURI);
    if (selected) utterance.voice = selected;
    utterance.onend = done;
    utterance.onerror = done;
    activeSpeechStop = () => {
      window.speechSynthesis.cancel();
      done();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function stopSpeaking({ quiet = false } = {}) {
  if (ttsController) {
    try { ttsController.abort(); } catch { /* ignore */ }
    ttsController = null;
  }
  if (activeSpeechStop) {
    try { activeSpeechStop(); } catch { /* ignore */ }
    activeSpeechStop = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  speaking = false;
  if (!quiet) setStage("", elements.caption.textContent);
}

function setupRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    elements.micButton.disabled = true;
    elements.voiceSupport.textContent = "このブラウザでは音声入力が使えません。ChromeまたはEdgeをご利用ください。";
    return;
  }

  recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    recognitionFinalSent = false;
    updateMicUi();
    setStage("listening", "どうぞ。話し終わると自動で送信します。");
  };

  recognition.onresult = (event) => {
    let transcript = "";
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    elements.messageInput.value = transcript;
    elements.caption.textContent = transcript || "聞いています…";
    if (isFinal && transcript.trim() && !recognitionFinalSent) {
      recognitionFinalSent = true;
      sendMessage(transcript);
    }
  };

  recognition.onerror = (event) => {
    const messagesByCode = {
      "not-allowed": "マイクの利用が許可されていません。Chromeのサイト設定でマイクを許可してください。",
      "no-speech": "聞き取れませんでした。もう一度話してください。",
      "network": "音声認識サービスへ接続できませんでした。文字入力をご利用ください。",
      "aborted": ""
    };
    const message = messagesByCode[event.error] ?? `音声入力エラー：${event.error}`;
    if (message) elements.voiceSupport.textContent = message;
  };

  recognition.onend = () => {
    listening = false;
    updateMicUi();
    if (conversationActive && settings.handsFree && !busy && !speaking && !recognitionFinalSent) {
      scheduleListening(450);
    } else if (!busy && !speaking && !conversationActive) {
      setStage("", elements.caption.textContent);
    }
  };

  updateMicUi();
}

function toggleListening() {
  if (!recognition) return;

  if (settings.handsFree) {
    if (conversationActive) {
      conversationActive = false;
      stopRecognition();
      stopSpeaking({ quiet: true });
      updateMicUi();
      setStage("", "会話を終了しました。もう一度始めるときは「会話を始める」を押してください。");
      return;
    }
    conversationActive = true;
    stopSpeaking({ quiet: true });
    updateMicUi();
    if (!busy) startRecognition();
    return;
  }

  if (busy) return;
  stopSpeaking({ quiet: true });
  if (listening) {
    try { recognition.stop(); } catch { /* ignore */ }
  } else {
    conversationActive = false;
    try { recognition.start(); } catch { /* already starting */ }
  }
}

function resetConversation() {
  conversationActive = false;
  stopRecognition();
  stopSpeaking({ quiet: true });
  messages = [];
  elements.messages.innerHTML = "";
  addMessage("assistant", "会話をリセットしました。何から始めますか？");
  updateMicUi();
  setStage("", "準備ができました。話しかけてください。");
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(elements.messageInput.value);
});
elements.micButton.addEventListener("click", toggleListening);
elements.stopVoiceButton.addEventListener("click", () => {
  stopSpeaking({ quiet: true });
  if (conversationActive && settings.handsFree) scheduleListening(150);
  else setStage("", elements.caption.textContent);
});
elements.reloadButton.addEventListener("click", loadKnowledge);
elements.clearButton.addEventListener("click", resetConversation);
elements.loadElevenVoicesButton.addEventListener("click", loadElevenVoices);

async function testCurrentElevenVoice() {
  const key = elements.elevenApiKeyInput.value.trim() || elevenApiKey;
  const dropdownId = elements.elevenVoiceIdInput.value.trim();
  const manualId = elements.elevenVoiceIdManualInput.value.trim();
  const voiceId = dropdownId || manualId;
  const modelId = elements.elevenModelSelect.value || "eleven_multilingual_v2";
  if (!key) {
    elements.elevenStatus.textContent = "ElevenLabs APIキーを入力してください。";
    return;
  }
  if (!voiceId) {
    elements.elevenStatus.textContent = "テストする声を選んでください。";
    return;
  }
  const selected = [...elements.elevenVoiceIdInput.options].find((o) => o.value === voiceId);
  const label = selected?.textContent || voiceId;
  elements.testElevenVoiceButton.disabled = true;
  elements.elevenStatus.textContent = `「${label}」をテスト再生しています…`;
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: key,
        voiceId,
        modelId,
        languageCode: "ja",
        text: "こんにちは。これが現在選択している声です。自然に聞こえるか確認してください。"
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `音声生成に失敗しました（${response.status}）。`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error("音声を再生できませんでした。"));
      audio.play().catch(reject);
    });
    URL.revokeObjectURL(url);
    elements.elevenStatus.textContent = `テスト成功：「${label}」で再生しました。この声でよければ下の「保存」を押してください。`;
  } catch (error) {
    elements.elevenStatus.textContent = `テスト失敗：${error.message}`;
  } finally {
    elements.testElevenVoiceButton.disabled = false;
  }
}

elements.testElevenVoiceButton.addEventListener("click", testCurrentElevenVoice);
elements.elevenVoiceIdInput.addEventListener("change", () => {
  if (elements.elevenVoiceIdInput.value) elements.elevenVoiceIdManualInput.value = elements.elevenVoiceIdInput.value;
});

elements.settingsButton.addEventListener("click", () => {
  elements.apiKeyInput.value = apiKey;
  elements.elevenApiKeyInput.value = elevenApiKey;
  applySettingsToUi();
  elements.settingsDialog.showModal();
});
elements.closeSettingsButton.addEventListener("click", () => elements.settingsDialog.close());
elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  apiKey = elements.apiKeyInput.value.trim();
  elevenApiKey = elements.elevenApiKeyInput.value.trim();
  const wasHandsFree = settings.handsFree;
  settings = {
    ownerName: elements.ownerNameInput.value.trim() || DEFAULT_SETTINGS.ownerName,
    partnerName: elements.partnerNameInput.value.trim() || DEFAULT_SETTINGS.partnerName,
    tone: elements.toneInput.value.trim() || DEFAULT_SETTINGS.tone,
    autoSpeak: elements.autoSpeakInput.checked,
    handsFree: elements.handsFreeInput.checked,
    voiceURI: elements.voiceSelect.value,
    elevenVoiceId: (elements.elevenVoiceIdInput.value.trim() || elements.elevenVoiceIdManualInput.value.trim()),
    elevenModel: elements.elevenModelSelect.value || DEFAULT_SETTINGS.elevenModel
  };
  if (wasHandsFree && !settings.handsFree) {
    conversationActive = false;
    stopRecognition();
  }
  saveSettings();
  applySettingsToUi();
  elements.settingsDialog.close();
  setConnection(apiKey ? "ready" : "", apiKey ? "接続準備OK" : "APIキー未設定");
  const voiceReady = elevenApiKey && settings.elevenVoiceId;
  elements.voiceSupport.textContent = voiceReady
    ? "自然音声の準備OKです。"
    : "ElevenLabs未設定時はMacの標準音声で読み上げます。";
  setStage("", apiKey ? "設定しました。話しかけてください。" : "設定からClaude APIキーを入力してください。");
});

applySettingsToUi();
setupRecognition();
populateVoices();
if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = populateVoices;
loadKnowledge();
setStage("", "準備ができました。話しかけてください。");
requestAnimationFrame(() => elements.settingsDialog.showModal());

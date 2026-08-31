import "./modern.css";
import { registerSW } from "virtual:pwa-register";
import { installCardManager, openCardManager } from "./card-manager";
import { migrateLegacyStorage, mirrorCustomCardsToLegacy } from "./migration";
import { mirrorSchedulesToLegacy, queueLegacyStateSave } from "./legacy-bridge";
import { examGain, retrievabilityAt, retrievabilityCurve, scheduleReview, undoLastReview } from "./fsrs";
import {
  deleteAll as deleteAllWritten,
  deleteDraft,
  deleteDraftsForSession,
  exportAll as exportWrittenAttempts,
  getAttempt,
  getDraft,
  importMany as importWrittenAttempts,
  listByQuestion,
  listPendingExamAttempts,
  saveAttempt,
  saveDraft,
  updateAttempt,
} from "./written";
import { learningDestination, primaryNavKey } from "./navigation";
import { getCardHomeSnapshot } from "./card-home";
import { exportStudyData, importStudyData } from "./backup";
import { renderMemoryCards } from "./memory-cards";
import type { LegacyProgress, ReviewRating } from "./types";

/**
 * このアプリは端末内だけで完結する。アカウント・クラウド同期・ランキング・掲示板は持たず、
 * 起動時に外部へ通信しない。端末を移すときは「設定・データ」の手動バックアップを使う。
 */
async function bootstrap(): Promise<void> {
  await migrateLegacyStorage();
  await mirrorCustomCardsToLegacy();
  await mirrorSchedulesToLegacy(); // ホームの復習予定を Dexie/FSRS と一致させる
  await installCardManager();
}

window.STUDY_CORE = {
  ui: {
    learningDestination,
    primaryNavKey,
  },
  scheduleReview: (progress, rating, cardId) =>
    scheduleReview(cardId, progress as LegacyProgress, rating as ReviewRating) as Record<string, unknown>,
  refreshCustomCards: mirrorCustomCardsToLegacy,
  saveLegacyProgress: (progress) => queueLegacyStateSave(progress as Record<string, LegacyProgress>),
  openCardManager,
  cardHome: {
    snapshot: getCardHomeSnapshot,
  },
  memoryCards: {
    render: renderMemoryCards,
  },
  backup: {
    exportStudy: exportStudyData,
    importStudy: importStudyData,
  },
  undoLastReview,
  memory: {
    retrievability: (progress, atMs) =>
      retrievabilityAt(progress as LegacyProgress, atMs == null ? new Date() : new Date(atMs)),
    curve: (progress, dayOffsets) => retrievabilityCurve(progress as LegacyProgress, dayOffsets),
    examGain: (progress, examMs) => examGain(progress as LegacyProgress, new Date(examMs)),
  },
  // 記述問題の答案履歴。index.html は Dexie を直接触らず、ここだけを使う
  writtenAttempts: {
    saveAttempt,
    updateAttempt,
    getAttempt,
    listByQuestion,
    listPendingExamAttempts,
    saveDraft,
    getDraft,
    deleteDraft,
    deleteDraftsForSession,
    exportAll: exportWrittenAttempts,
    importMany: importWrittenAttempts,
    deleteAll: deleteAllWritten,
  },
};

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // 短時間に何度も叩かないよう最低30秒はあける（タブ切り替えのたびに走るため）。
    const MIN_GAP = 30 * 1000;
    let lastCheck = Date.now();
    const check = () => {
      if (!navigator.onLine) return;
      const now = Date.now();
      if (now - lastCheck < MIN_GAP) return;
      lastCheck = now;
      void registration.update();
    };
    window.setInterval(check, 60 * 60 * 1000);
    // スマホは「ホームに戻す→また開く」が多く、その場合ページは再読み込みされない。
    // 画面がふたたび見えたときと、回線が戻ったときにも更新を確認する。
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("online", check);
  },
  onRegisterError(error) {
    console.error("アプリの自動更新を登録できませんでした", error);
  },
});

void bootstrap().catch((error) => {
  console.error("学習データ基盤の初期化に失敗しました", error);
  document.documentElement.dataset.studyInitError = "1";
});

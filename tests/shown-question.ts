/* 演習画面にいま出ている1問を、教材データ側で特定する。

   問題文の書き出しだけで探すと、「会話文中の空欄　ア　・　イ　に当てはまる語句の
   組合せとして……」のように出だしが同じ問題が複数あるため、別の問題を取り違えて
   選択肢の数や正解番号がずれることがある。選択肢の顔ぶれまで照合して1問に絞る。 */
export function findShownQuestion(win: any): any {
  const shown = win.document.querySelector("#qBlocks .qtext")!.textContent!.trim();
  const rendered = [...win.document.querySelectorAll("#qBlocks .choice .choiceText")]
    .map((e: any) => e.textContent.trim()).sort();
  const candidates = win.QUIZ_DATA.filter((x: any) => shown.startsWith(String(x.question).trim().slice(0, 30)));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return candidates.find((x: any) => same(rendered, x.choices.map((c: string) => String(c).trim()).sort()))
    ?? candidates[0];
}

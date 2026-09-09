/* 科目が2つ以上あるので、起動直後は「科目えらび」画面が出る。
   ビルド済みアプリを読み込むテストは、まずここで科目へ入ってからホームを操作する。
   演習の途中で読み込み直した控えがあるときは科目えらびを挟まないので、
   その場合はホーム（または演習画面）が出るまで待つだけでよい。 */
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function enterSubject(win: any, id = "civics"): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (win.document.getElementById("hubGrid")?.children.length) return;   // すでに科目に入っている
    const tile = win.document.querySelector(`#spGrid .spCard[data-subject="${id}"]`) as any;
    if (tile) { tile.click(); break; }
    await tick(25);
  }
  for (let i = 0; i < 200 && !(win.document.getElementById("hubGrid")?.children.length); i += 1) await tick(25);
}

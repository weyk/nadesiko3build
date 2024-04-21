/**
 * コマンドライン版のなでしこ3
 */
import { Nako3Build } from './nako3buildmod.mjs'

// メイン
(async () => {
  const nako3: Nako3Build = new Nako3Build()
  try {
    await nako3.execCommand()
  } catch (err: any) {
    // 何かしらのエラーがあればコンソールに返す
    // ここで出るエラーは致命的なエラー
    console.error('[nako3buildのエラー]', err)
  }
})()

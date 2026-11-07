async function o(r,e={},n){return window.__TAURI_INTERNALS__.invoke(r,e,n)}async function s(){await o("plugin:process|restart")}export{s as relaunch};

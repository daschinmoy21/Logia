// import { useState } from "react";
// import reactLogo from "./assets/react.svg";
// import { invoke } from "@tauri-apps/api/core";
import Editor from "./components/Editor.tsx";
import "./App.css";
import { Sidebar } from "./components/Sidebar.tsx";
import { useState } from "react";

function App() {
  // const [greetMsg, setGreetMsg] = useState("");
  // const [name, setName] = useState("");
  //
  // async function greet() {
  //   // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  //   setGreetMsg(await invoke("greet", { name }));
  // }

  const [isCommandPalleteOpen, setIsCommandPalleteOpen] = useState(false);

  const toggleCommandPallete = () => {
    setIsCommandPalleteOpen(!isCommandPalleteOpen);
  };

  return (
    <div className="bg-zinc-950 flex h-screen overflow-hidden">
      <div className="h-full flex-shrink-0">
        <Sidebar toggleCommandPallete={toggleCommandPallete} />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Editor />
      </div>
    </div>
  );
}

export default App;

const { appWindow } = window.__TAURI__.window;
const timerElement = document.getElementById('timer');
const stopBtn = document.getElementById('stopBtn');

let startTime;
let timerInterval;

function updateTimer() {
  const now = Date.now();
  const diff = now - startTime;
  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

appWindow.listen('start-recording', (event) => {
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
});

stopBtn.addEventListener('click', () => {
  clearInterval(timerInterval);
  appWindow.close();
});
import React, { useState, useRef } from 'react';
import { Mic, Square, Upload, Play, Volume2, Settings, Activity, AlertCircle, Share2, Sparkles, Key } from 'lucide-react';

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [sampleBase64, setSampleBase64] = useState("");
  const [status, setStatus] = useState("Siap");
  const [outputAudio, setOutputAudio] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  
  // State untuk API Key agar bisa diinput langsung di web jika 403
  const [inputKey, setInputKey] = useState("");
  const [savedKey, setSavedKey] = useState(localStorage.getItem('gemini_api_key') || "");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const handleSampleUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSampleBase64(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
      setStatus("Sampel dimuat");
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        processVoice(blob);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatus("Merekam...");
    } catch (err) {
      setError("Gagal akses mik. Gunakan HTTPS.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
  };

  const processVoice = async (inputBlob) => {
    if (!sampleBase64) return setError("Upload sampel suara target dulu!");
    if (!savedKey) return setError("API Key Gemini belum diisi!");

    setIsProcessing(true);
    setStatus("Menghubungkan Gemini...");

    try {
      const inputBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(inputBlob);
      });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${savedKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Ubah suara input agar identik dengan suara sampel. Output hanya audio." },
              { inlineData: { mimeType: "audio/webm", data: sampleBase64 } },
              { inlineData: { mimeType: "audio/webm", data: inputBase64 } }
            ]
          }],
          generationConfig: { 
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
          }
        })
      });

      if (response.status === 403) throw new Error("API Key salah atau dilarang (403).");
      
      const result = await response.json();
      const audioData = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;

      if (audioData) {
        const blob = new Blob([Uint8Array.from(atob(audioData), c => c.charCodeAt(0))], { type: 'audio/wav' });
        setOutputAudio(URL.createObjectURL(blob));
        setStatus("Selesai!");
      } else {
        throw new Error("AI tidak merespon audio.");
      }
    } catch (err) {
      setError(err.message);
      setStatus("Error");
    } finally {
      setIsProcessing(false);
    }
  };

  const saveApiKey = () => {
    localStorage.setItem('gemini_api_key', inputKey);
    setSavedKey(inputKey);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-white p-4 font-sans flex flex-col items-center">
      <div className="w-full max-w-md space-y-4">
        <header className="bg-[#202c33] p-4 rounded-xl flex items-center gap-3 border-b border-[#00a884]">
          <div className="bg-[#00a884] p-2 rounded-full"><Mic size={20}/></div>
          <h1 className="font-bold">WA Voice Cloner AI</h1>
        </header>

        {/* API Key Settings */}
        {!savedKey && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-xl space-y-3">
            <p className="text-xs text-yellow-500 flex items-center gap-2"><Key size={14}/> Masukkan API Key Gemini:</p>
            <div className="flex gap-2">
              <input 
                type="password" 
                className="bg-[#2a3942] flex-1 px-3 py-2 rounded-lg text-sm border border-[#313d45]"
                placeholder="AIzaSy..."
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
              />
              <button onClick={saveApiKey} className="bg-[#00a884] px-4 py-2 rounded-lg text-sm font-bold">Simpan</button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/40 p-3 rounded-lg text-xs text-red-400 flex gap-2">
            <AlertCircle size={16}/> {error}
            <button onClick={() => {localStorage.clear(); window.location.reload();}} className="underline ml-auto">Reset</button>
          </div>
        )}

        <div className="bg-[#202c33] p-6 rounded-2xl border border-[#313d45] space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#8696a0] uppercase tracking-widest">1. Suara Target</label>
            <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-[#313d45] rounded-xl cursor-pointer hover:bg-[#2a3942]">
              <Upload className="text-[#8696a0] mr-2" size={18}/>
              <span className="text-sm text-[#8696a0]">{sampleBase64 ? "Sampel Berhasil" : "Upload Suara Target"}</span>
              <input type="file" className="hidden" accept="audio/*" onChange={handleSampleUpload} />
            </label>
          </div>

          <div className="flex flex-col items-center py-4 space-y-4">
            <button
              onMouseDown={startRecording} onMouseUp={stopRecording}
              onTouchStart={startRecording} onTouchEnd={stopRecording}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl ${
                isRecording ? 'bg-red-500 scale-110 animate-pulse' : 'bg-[#00a884]'
              }`}
            >
              {isRecording ? <Square fill="white" size={24}/> : <Mic size={32}/>}
            </button>
            <p className="text-[10px] font-bold text-[#8696a0] uppercase tracking-[0.2em]">
              {isRecording ? "Sedang Merekam..." : "Tahan Tombol untuk Bicara"}
            </p>
          </div>

          {outputAudio && (
            <div className="space-y-3 animate-in fade-in">
              <audio src={outputAudio} controls className="w-full h-10 invert brightness-200" />
              <button onClick={() => window.open(`https://api.whatsapp.com/send?text=Cek suara kloning saya!`)} 
                      className="w-full bg-[#25D366] text-[#0b141a] py-3 rounded-xl font-black flex items-center justify-center gap-2">
                <Share2 size={20}/> KIRIM KE WHATSAPP
              </button>
            </div>
          )}
        </div>

        <footer className="text-center text-[10px] text-[#8696a0] flex items-center justify-center gap-2">
          <Activity size={12}/> Status: {status}
        </footer>
      </div>
    </div>
  );
}


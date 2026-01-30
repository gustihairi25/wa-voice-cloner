import React, { useState, useRef } from 'react';
import { Mic, Square, Upload, AlertCircle, Share2, Key, RefreshCw, Zap } from 'lucide-react';

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [sampleBase64, setSampleBase64] = useState("");
  const [status, setStatus] = useState("Siap");
  const [outputAudio, setOutputAudio] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [savedKey, setSavedKey] = useState(localStorage.getItem('gemini_api_key') || "");
  const [inputKey, setInputKey] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const handleSampleUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSampleBase64(reader.result.split(',')[1]);
        setStatus("Target Terkunci");
      };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    setError(null);
    setOutputAudio(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        // Minimal 10kb data agar tidak dianggap kosong
        if (blob.size < 10000) {
          setError("Rekaman gagal atau terlalu singkat. Coba lagi.");
          return;
        }
        processWithGemini(blob);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatus("Merekam...");
    } catch (err) {
      setError("Izin mikrofon ditolak.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processWithGemini = async (inputBlob) => {
    if (!sampleBase64 || !savedKey) return setError("Lengkapi Sampel & API Key");
    setIsProcessing(true);
    setStatus("AI Cloning...");

    try {
      const inputBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(inputBlob);
      });

      // MENGGUNAKAN LOGIKA SPEECH-TO-SPEECH (BUKAN TEXT-TO-SPEECH)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${savedKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "TUGAS: Ubah suara input user agar memiliki karakter, nada, dan warna suara yang SAMA PERSIS dengan sampel suara target. Jangan gunakan suara robot bawaan. Hasil harus dalam format audio." },
              { inlineData: { mimeType: "audio/webm", data: sampleBase64 } },
              { inlineData: { mimeType: "audio/webm", data: inputBase64 } }
            ]
          }],
          generationConfig: { responseModalities: ["AUDIO"] }
        })
      });

      const result = await response.json();
      const audioData = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;

      if (audioData) {
        const binaryString = atob(audioData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/wav' });
        setOutputAudio(URL.createObjectURL(blob));
        setStatus("Selesai!");
      } else {
        throw new Error("AI gagal meniru suara. Coba bicara lebih jelas.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef] p-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        <header className="bg-[#202c33] p-4 rounded-2xl flex items-center gap-4 border-b border-[#00a884]">
          <Zap size={24} className="text-[#00a884]"/>
          <h1 className="font-bold text-lg">WA Voice Cloner PRO</h1>
        </header>

        {!savedKey && (
          <div className="bg-[#1d2a33] p-4 rounded-xl border border-yellow-500/30">
            <input 
              type="password" 
              className="w-full bg-[#2a3942] p-2 rounded-lg text-sm mb-2"
              placeholder="Masukkan API Key Gemini..."
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
            />
            <button onClick={() => {localStorage.setItem('gemini_api_key', inputKey); setSavedKey(inputKey);}} className="w-full bg-[#00a884] py-2 rounded-lg font-bold">Aktifkan AI</button>
          </div>
        )}

        {error && <div className="bg-red-500/20 p-3 rounded-lg text-red-400 text-xs">{error}</div>}

        <div className="bg-[#202c33] p-6 rounded-3xl shadow-xl space-y-6">
          <label className="block border-2 border-dashed border-[#313d45] p-4 rounded-xl text-center cursor-pointer">
            <Upload className="mx-auto mb-2 text-[#8696a0]"/>
            <span className="text-xs text-[#8696a0]">{sampleBase64 ? "Suara Target Siap" : "Upload Suara yang Ingin Ditiru"}</span>
            <input type="file" className="hidden" accept="audio/*" onChange={handleSampleUpload} />
          </label>

          <div className="flex flex-col items-center gap-4">
            <button
              onMouseDown={startRecording} onMouseUp={stopRecording}
              onTouchStart={startRecording} onTouchEnd={stopRecording}
              className={`w-20 h-20 rounded-full flex items-center justify-center ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-[#00a884]'}`}
            >
              {isRecording ? <Square size={24}/> : <Mic size={32}/>}
            </button>
            <p className="text-[10px] uppercase font-bold text-[#8696a0]">Tahan untuk bicara</p>
          </div>

          {isProcessing ? <div className="text-center animate-bounce text-[#00a884] text-xs">AI Sedang Meniru Suara...</div> : 
           outputAudio && (
             <div className="space-y-3">
               <audio src={outputAudio} controls className="w-full invert grayscale" />
               <button onClick={() => window.open(`https://api.whatsapp.com/send?text=Dengarkan AI Clone ini!`)} className="w-full bg-[#25D366] py-3 rounded-xl font-bold text-[#0b141a]">Kirim ke WhatsApp</button>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

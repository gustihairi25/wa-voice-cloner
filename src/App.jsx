import React, { useState, useRef } from 'react';
import { Mic, Square, Upload, Play, Volume2, Settings, MessageSquare, Activity, AlertCircle, Share2, Download, CheckCircle2, RefreshCw } from 'lucide-react';

// Global variable untuk API Key (akan diisi otomatis oleh environment)
const apiKey = typeof __app_id !== 'undefined' ? "" : ""; 

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [sampleAudio, setSampleAudio] = useState(null);
  const [sampleBase64, setSampleBase64] = useState("");
  const [status, setStatus] = useState("Siap");
  const [outputAudio, setOutputAudio] = useState(null);
  const [outputBlob, setOutputBlob] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const addLog = (msg) => {
    setLogs(prev => [msg, ...prev].slice(0, 5));
  };

  const handleSampleUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Ukuran sampel maksimal 5MB.");
        return;
      }
      setError(null);
      setSampleAudio(URL.createObjectURL(file));
      const reader = new FileReader();
      reader.onloadend = () => {
        setSampleBase64(reader.result.split(',')[1]);
        addLog("Sampel '" + file.name + "' berhasil dimuat.");
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

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        processVoiceConversion(blob);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatus("Merekam...");
      addLog("Merekam suara Anda...");
    } catch (err) {
      setError("Izin mikrofon ditolak.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  // Fungsi konversi PCM ke WAV yang lebih akurat untuk Gemini
  const pcmToWav = (pcmData, sampleRate = 24000) => {
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Linear PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcmData.length, true);
    const pcmArray = new Uint8Array(pcmData);
    for (let i = 0; i < pcmArray.length; i++) {
      view.setUint8(44 + i, pcmArray[i]);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const processVoiceConversion = async (inputBlob) => {
    if (!sampleBase64) {
      setError("Unggah sampel suara target dulu.");
      return;
    }

    setIsProcessing(true);
    setStatus("Menghubungkan AI...");
    addLog("Mengirim ke Gemini 2.5...");

    try {
      const inputBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(inputBlob);
      });

      // API Endpoint Gemini 2.5 Flash
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Ubah audio input agar terdengar persis seperti audio sampel. Pastikan nada, timbre, dan gaya bicara identik. Keluarkan hasilnya dalam format audio." },
              { inlineData: { mimeType: "audio/webm", data: sampleBase64 } },
              { inlineData: { mimeType: "audio/webm", data: inputBase64 } }
            ]
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { 
              voiceConfig: { 
                prebuiltVoiceConfig: { voiceName: "Puck" } // Menggunakan voice dasar Gemini untuk kestabilan
              } 
            }
          }
        })
      });

      if (!response.ok) {
        if (response.status === 403) throw new Error("Akses Ditolak (API Key 403). Gunakan koneksi stabil.");
        throw new Error(`Server Error: ${response.status}`);
      }

      const result = await response.json();
      const audioPart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

      if (audioPart) {
        const rawData = atob(audioPart.inlineData.data);
        const uint8Array = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) uint8Array[i] = rawData.charCodeAt(i);
        
        const wavBlob = pcmToWav(uint8Array);
        setOutputBlob(wavBlob);
        setOutputAudio(URL.createObjectURL(wavBlob));
        setStatus("Selesai");
        addLog("Kloning Berhasil!");
      } else {
        throw new Error("AI tidak mengembalikan data audio.");
      }
    } catch (err) {
      setError(err.message);
      setStatus("Gagal");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShareToWhatsApp = async () => {
    if (!outputBlob) return;
    try {
      const file = new File([outputBlob], "VoiceNote.wav", { type: "audio/wav" });
      if (navigator.share) {
        await navigator.share({ files: [file], title: 'Voice Note' });
      } else {
        const link = document.createElement('a');
        link.href = outputAudio;
        link.download = "VoiceNote.wav";
        link.click();
      }
    } catch (err) { addLog("Batal kirim."); }
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef] p-4 flex flex-col items-center font-sans">
      <div className="w-full max-w-md space-y-6">
        
        <header className="flex items-center gap-4 bg-[#202c33] p-4 rounded-2xl border-b border-[#313d45]">
          <div className="bg-[#00a884] p-3 rounded-full">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Voice Cloner WA</h1>
            <p className="text-[10px] text-[#8696a0] font-bold uppercase tracking-widest">Powered by Gemini 2.5</p>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex gap-3 text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div className="bg-[#202c33] p-5 rounded-2xl border border-[#313d45] space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#00a884]" /> 1. Sampel Suara Target
          </h2>
          
          {!sampleAudio ? (
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#313d45] rounded-xl cursor-pointer">
              <Upload className="w-6 h-6 text-[#8696a0] mb-2" />
              <span className="text-xs text-[#8696a0]">Upload Suara Target</span>
              <input type="file" className="hidden" accept="audio/*" onChange={handleSampleUpload} />
            </label>
          ) : (
            <div className="bg-[#2a3942] p-3 rounded-xl flex items-center justify-between border border-[#00a884]/30">
              <span className="text-xs text-[#00a884] font-bold">SAMPLER AKTIF</span>
              <button onClick={() => setSampleAudio(null)} className="text-[10px] text-red-400 font-bold">GANTI</button>
            </div>
          )}
        </div>

        <div className="bg-[#202c33] p-8 rounded-2xl border border-[#313d45] flex flex-col items-center shadow-inner">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
              isRecording ? 'bg-red-500 animate-pulse' : 'bg-[#00a884]'
            } shadow-xl active:scale-95`}
          >
            {isRecording ? <Square className="w-8 h-8 text-white fill-white" /> : <Mic className="w-10 h-10 text-white" />}
          </button>
          <p className="mt-6 text-xs font-bold tracking-widest text-[#8696a0]">
            {isRecording ? "SEDANG MEREKAM..." : "TAHAN UNTUK BICARA"}
          </p>
        </div>

        {(isProcessing || outputAudio) && (
          <div className="bg-[#202c33] p-6 rounded-2xl border border-[#00a884]/30 animate-in fade-in">
            {isProcessing ? (
              <div className="flex flex-col items-center gap-4">
                <div className="flex gap-1.5 h-8 items-end">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-1.5 bg-[#00a884] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
                <p className="text-[10px] font-black text-[#00a884]">MENGHUBUNGKAN KE AI...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <audio src={outputAudio} controls className="w-full h-10" />
                <button
                  onClick={handleShareToWhatsApp}
                  className="w-full bg-[#00a884] text-[#0b141a] font-black py-4 rounded-xl flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-all"
                >
                  <Share2 className="w-5 h-5" /> KIRIM KE WHATSAPP
                </button>
              </div>
            )}
          </div>
        )}

        <footer className="text-center pb-8">
           <p className="text-[10px] text-[#8696a0] opacity-50 flex items-center justify-center gap-2">
             <Activity className="w-3 h-3" /> Status: {status}
           </p>
        </footer>

      </div>
    </div>
  );
};

export default App;


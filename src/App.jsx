import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Upload, Play, Volume2, Settings, MessageSquare, Activity, AlertCircle, Share2, Download, CheckCircle2, RefreshCw } from 'lucide-react';

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
  const apiKey = ""; // Disediakan oleh environment runtime

  const addLog = (msg) => {
    setLogs(prev => [msg, ...prev].slice(0, 5));
  };

  const handleSampleUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Ukuran sampel maksimal 5MB. File Anda: " + (file.size / (1024 * 1024)).toFixed(2) + "MB");
        return;
      }
      setError(null);
      setSampleAudio(URL.createObjectURL(file));
      const reader = new FileReader();
      reader.onloadend = () => {
        setSampleBase64(reader.result.split(',')[1]);
        addLog("Sampel '" + file.name + "' berhasil dimuat.");
      };
      reader.onerror = () => setError("Gagal membaca file audio sampel.");
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    setError(null);
    setOutputAudio(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let options = { mimeType: 'audio/webm;codecs=opus' };
      if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options = { mimeType: 'audio/ogg;codecs=opus' };
      }
      
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: options.mimeType });
        if (blob.size < 1000) {
          setError("Hasil rekaman terlalu pendek atau kosong.");
          setStatus("Gagal");
          return;
        }
        processVoiceConversion(blob);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatus("Merekam...");
      addLog("Merekam input suara Anda...");
    } catch (err) {
      setError("Izin mikrofon ditolak. Periksa pengaturan privasi browser Anda.");
      setStatus("Gagal");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatus("Memproses...");
      // Stop all tracks to release microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const createWavBlob = (pcmData, sampleRate = 24000) => {
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
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
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
    return new Blob([buffer], { type: 'audio/ogg' });
  };

  const processVoiceConversion = async (inputBlob) => {
    if (!sampleBase64) {
      setError("Silakan unggah sampel suara target terlebih dahulu.");
      setStatus("Siap");
      return;
    }

    setIsProcessing(true);
    addLog("Mengirim data ke AI Gemini...");
    
    try {
      const inputBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(inputBlob);
      });

      const systemPrompt = `Kamu adalah pengubah suara real-time. 
      Tugas: Ubah suara dari 'user_input' agar memiliki warna suara, nada, dan logat yang IDENTIK dengan 'sample_voice'.
      Pesan yang diucapkan harus SAMA PERSIS dengan apa yang dikatakan user.
      Keluarkan respon hanya dalam format audio.`;

      // Implementasi Exponential Backoff untuk Retry
      const fetchWithRetry = async (url, options, retries = 5, delay = 1000) => {
        try {
          const res = await fetch(url, options);
          if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
          return await res.json();
        } catch (err) {
          if (retries <= 0) throw err;
          await new Promise(r => setTimeout(r, delay));
          return fetchWithRetry(url, options, retries - 1, delay * 2);
        }
      };

      const result = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: systemPrompt },
              { inlineData: { mimeType: "audio/webm", data: sampleBase64 } },
              { inlineData: { mimeType: "audio/webm", data: inputBase64 } }
            ]
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
          }
        })
      });

      const audioPart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

      if (audioPart) {
        const rawData = atob(audioPart.inlineData.data);
        const pcmData = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) pcmData[i] = rawData.charCodeAt(i);
        
        const finalBlob = createWavBlob(pcmData);
        setOutputBlob(finalBlob);
        setOutputAudio(URL.createObjectURL(finalBlob));
        setStatus("Selesai");
        addLog("Berhasil! Klik tombol Kirim.");
      } else {
        throw new Error("AI tidak menghasilkan audio. Coba bicara lebih jelas.");
      }
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan server: " + (err.message || "Unknown error"));
      setStatus("Gagal");
      addLog("Gagal: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShareToWhatsApp = async () => {
    if (!outputBlob) return;
    const file = new File([outputBlob], "PTT-" + new Date().getTime() + ".ogg", { type: "audio/ogg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Voice Note' });
      } catch (err) { addLog("Batal kirim."); }
    } else {
      const link = document.createElement('a');
      link.href = outputAudio;
      link.download = "pesan_suara.ogg";
      link.click();
      setError("Gunakan HP agar bisa langsung jadi Voice Note di WhatsApp.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef] font-sans p-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        
        <header className="flex items-center gap-4 bg-[#202c33] p-4 rounded-2xl shadow-lg border-b border-[#313d45]">
          <div className="bg-[#00a884] p-3 rounded-full">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Voice Cloner WA</h1>
            <p className="text-[10px] text-[#8696a0] font-bold uppercase tracking-widest">v2.1 - Debug Enabled</p>
          </div>
        </header>

        {error && (
          <div className="bg-[#f15c6d]/10 border border-[#f15c6d]/20 p-4 rounded-xl flex gap-3 text-[#f15c6d] text-sm shadow-lg">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-bold mb-1">Terjadi Masalah:</p>
              <p className="opacity-80">{error}</p>
              <button 
                onClick={() => window.location.reload()} 
                className="mt-3 flex items-center gap-2 bg-[#f15c6d] text-white px-3 py-1 rounded-lg text-xs font-bold"
              >
                <RefreshCw className="w-3 h-3" /> Refresh Halaman
              </button>
            </div>
          </div>
        )}

        <div className="bg-[#202c33] p-5 rounded-2xl border border-[#313d45] space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#00a884]" />
            <h2 className="text-sm font-semibold">1. Unggah Suara Target</h2>
          </div>
          
          {!sampleAudio ? (
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#313d45] rounded-xl cursor-pointer hover:bg-[#2a3942] transition-colors">
              <Upload className="w-6 h-6 text-[#8696a0] mb-2" />
              <span className="text-xs text-[#8696a0]">Pilih Sampel Karakter</span>
              <input type="file" className="hidden" accept="audio/*" onChange={handleSampleUpload} />
            </label>
          ) : (
            <div className="bg-[#2a3942] p-3 rounded-xl flex items-center justify-between border border-[#00a884]/30">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#00a884]" />
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#00a884]">SIAP</span>
                  <span className="text-[9px] text-slate-400">Sampel Suara Aktif</span>
                </div>
              </div>
              <button onClick={() => setSampleAudio(null)} className="text-[10px] text-[#f15c6d] font-bold px-2 py-1 bg-red-500/10 rounded-lg">GANTI</button>
            </div>
          )}
        </div>

        <div className="bg-[#202c33] p-8 rounded-2xl border border-[#313d45] flex flex-col items-center shadow-inner">
          <div className="mb-8 text-center">
            <h2 className="text-sm font-semibold mb-1">2. Rekam Pesan Anda</h2>
            <p className="text-[11px] text-[#8696a0]">Pastikan Anda sudah mengunggah sampel di atas</p>
          </div>

          <div className="relative">
            {isRecording && <div className="absolute inset-[-20px] bg-[#00a884]/10 rounded-full animate-ping" />}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                isRecording ? 'bg-[#f15c6d]' : 'bg-[#00a884]'
              } disabled:opacity-50`}
            >
              {isRecording ? <Square className="w-8 h-8 text-white fill-white" /> : <Mic className="w-10 h-10 text-white" />}
            </button>
          </div>
          
          <div className="mt-8 flex items-center gap-2">
            <p className={`text-xs font-bold tracking-widest ${isRecording ? 'text-[#f15c6d]' : 'text-[#8696a0]'}`}>
              {isRecording ? "SEDANG MEREKAM..." : "MULAI BICARA"}
            </p>
          </div>
        </div>

        {(isProcessing || outputAudio) && (
          <div className="bg-[#202c33] p-6 rounded-2xl border border-[#00a884]/30 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            {isProcessing ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex gap-1.5 items-end h-8">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-1.5 bg-[#00a884] rounded-full animate-wave" style={{ height: '40%', animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
                <p className="text-[10px] font-black text-[#00a884] tracking-widest">SEDANG MENGKLONING...</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-[#00a884]" />
                      <h2 className="text-sm font-bold">Hasil Kloning</h2>
                   </div>
                   <span className="text-[10px] bg-[#00a884]/20 text-[#00a884] px-2 py-0.5 rounded-full font-bold">SIAP KIRIM</span>
                </div>

                <div className="bg-[#111b21] p-4 rounded-xl border border-[#313d45]">
                  <audio src={outputAudio} controls className="w-full h-8" />
                </div>

                <button
                  onClick={handleShareToWhatsApp}
                  className="w-full bg-[#00a884] hover:bg-[#06cf9c] text-[#0b141a] font-black py-4 rounded-xl flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-all"
                >
                  <Share2 className="w-5 h-5" />
                  KIRIM KE WHATSAPP
                </button>
              </div>
            )}
          </div>
        )}

        <footer className="text-center pb-8 flex flex-col items-center gap-2">
          <div className="inline-flex items-center gap-2 text-[#8696a0] text-[9px] uppercase font-bold tracking-[0.2em] opacity-50">
            <Activity className="w-3 h-3" />
            <span>Status: {logs[0] || "Menunggu"}</span>
          </div>
        </footer>

      </div>
      <style>{`
        @keyframes wave {
          0%, 100% { height: 40%; }
          50% { height: 100%; }
        }
        .animate-wave {
          animation: wave 0.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default App;



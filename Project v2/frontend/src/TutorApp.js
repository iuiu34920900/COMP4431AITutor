import React, { useState } from "react";
import "./TutorApp.css";

const API_URL = process.env.REACT_APP_API_URL || "/tutor";

function TutorApp() {
  const [studentId, setStudentId] = useState("");
  const [inputText, setInputText] = useState("");
  const [imageBase64, setImageBase64] = useState(null);
  const [imageName, setImageName] = useState("");
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState(null);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) {
      setImageBase64(null);
      setImageName("");
      return;
    }
    setImageName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => setImageBase64(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputText.trim() && !imageBase64) return;

    setLoading(true);
    setError(null);
    setIntent(null);
    setResponse(null);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_text: inputText.trim(),
          input_image: imageBase64 || undefined,
          student_id: studentId.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error (${res.status})`);
      }

      const data = await res.json();
      setIntent(data.intent);
      setResponse(data.response);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const renderResponse = (text) => {
    // Bold markdown-style headers: ** Header **
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="response-heading">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="tutor-container">
      <h1 className="tutor-title">🎓 AI Tutor</h1>
      <p className="tutor-subtitle">
        Ask about AI / CS concepts, upload diagrams, or paste buggy code.
      </p>

      <form className="tutor-form" onSubmit={handleSubmit}>
        <input
          className="tutor-student-id"
          type="text"
          placeholder="Student ID (optional, enables memory)"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
        />

        <textarea
          className="tutor-textarea"
          rows={5}
          placeholder="Type your question here..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />

        <label className="tutor-upload-label">
          📎 Upload Image (optional)
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="tutor-file-input"
          />
        </label>
        {imageName && <span className="tutor-file-name">{imageName}</span>}

        <button type="submit" className="tutor-button" disabled={loading}>
          {loading ? "Thinking..." : "Ask Tutor"}
        </button>
      </form>

      {error && <div className="tutor-error">⚠️ {error}</div>}

      {response && (
        <div className="tutor-response">
          <div className="tutor-intent-badge">
            Intent: <strong>{intent}</strong>
          </div>
          <div className="tutor-response-body">{renderResponse(response)}</div>
        </div>
      )}
    </div>
  );
}

export default TutorApp;

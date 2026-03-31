import { useState, useCallback, type DragEvent } from "react";
import { hashFile } from "../utils/hash";

interface Props {
  onFileHashed: (hash: `0x${string}`, fileName: string) => void;
}

export default function FileDropZone({ onFileHashed }: Props) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setHashing(true);
      try {
        const hash = await hashFile(file);
        onFileHashed(hash, file.name);
      } finally {
        setHashing(false);
      }
    },
    [onFileHashed]
  );

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
        dragging
          ? "border-pink-500 bg-pink-500/10"
          : "border-gray-700 hover:border-gray-500"
      }`}
    >
      <input
        type="file"
        onChange={handleFileInput}
        className="hidden"
        id="file-input"
      />
      <label htmlFor="file-input" className="cursor-pointer">
        {hashing ? (
          <p className="text-yellow-400">Hashing...</p>
        ) : fileName ? (
          <p className="text-gray-300">
            {fileName}{" "}
            <span className="text-gray-500 text-sm">(drop another to replace)</span>
          </p>
        ) : (
          <p className="text-gray-400">
            Drop a file here or click to select
          </p>
        )}
      </label>
    </div>
  );
}

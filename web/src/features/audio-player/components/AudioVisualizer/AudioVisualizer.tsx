import React from "react";
import styles from "./AudioVisualizer.module.css";

interface AudioVisualizerProps {
  isPlaying: boolean;
  variant?: "mini" | "fullscreen";
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying, variant = "fullscreen" }) => {
  return (
    <div className={`${styles.visualizer} ${styles[variant]} ${isPlaying ? styles.animate : ""}`}>
      <div className={styles.visBar}></div>
      <div className={styles.visBar}></div>
      <div className={styles.visBar}></div>
      <div className={styles.visBar}></div>
      <div className={styles.visBar}></div>
    </div>
  );
};

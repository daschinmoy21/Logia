import React from 'react';
import { useState, useEffect } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

function Canvas() {
  return (
    <>
      <div style={{ height: "100%" }}>
        <Excalidraw
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
            }
          }}
          initialData={{
            appState: {
              viewBackgroundColor: "#ffffff",
              zenModeEnabled: false,
              gridSize: null,
            }
          }}
        />
      </div>
    </>
  )

}

import { invoke } from '@tauri-apps/api/core';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export interface ImageReference {
  id: string;
  filename: string;
  originalData: string;
}

export interface ProcessedScene {
  elements: readonly ExcalidrawElement[];
  images: ImageReference[];
}

/**
 * Extract base64 images from Excalidraw elements and replace with references
 */
export async function extractImagesFromElements(
  elements: readonly ExcalidrawElement[],
  noteId: string
): Promise<ProcessedScene> {
  const images: ImageReference[] = [];
  const processedElements = elements.map(element => {
    // Check if element has image data (base64)
    if (element.type === 'image' && 'fileId' in element && element.fileId) {
      const imageElement = element as any;
      if (imageElement.dataURL && imageElement.dataURL.startsWith('data:image/')) {
        // Extract base64 data
        const base64Data = imageElement.dataURL;
        const imageId = imageElement.fileId;

        // Generate filename
        const filename = `${noteId}_${imageId}.png`;

        console.log(`Found image for note ${noteId}: ${imageId} -> ${filename}`);

        // Add to images array
        images.push({
          id: imageId,
          filename,
          originalData: base64Data
        });

        // Create new element with reference instead of data
        return {
          ...element,
          dataURL: `file://${filename}`, // Reference to saved file
        };
      }
    }
    return element;
  });

  console.log(`Extracted ${images.length} images from ${elements.length} elements for note ${noteId}`);

  return {
    elements: processedElements,
    images
  };
}

/**
 * Save images to filesystem using Tauri
 */
export async function saveImages(images: ImageReference[], noteId: string): Promise<void> {
  if (images.length === 0) return;

  console.log(`Saving ${images.length} images for note ${noteId}`);

  try {
    await invoke('save_excalidraw_images', {
      images,
      noteId
    });
    console.log(`Successfully saved ${images.length} images for note ${noteId}`);
  } catch (error) {
    console.error('Failed to save images:', error);
    throw error;
  }
}

/**
 * Load images from filesystem and restore to elements
 */
export async function loadImagesForNote(noteId: string): Promise<Record<string, string>> {
  console.log(`Loading images for note ${noteId}`);

  try {
    const imageData: Record<string, string> = await invoke('load_excalidraw_images', {
      noteId
    });
    console.log(`Loaded ${Object.keys(imageData).length} images for note ${noteId}`);
    return imageData;
  } catch (error) {
    console.error('Failed to load images:', error);
    return {};
  }
}

/**
 * Restore image data to elements using loaded images
 */
export function restoreImagesToElements(
  elements: readonly ExcalidrawElement[],
  imageData: Record<string, string>
): readonly ExcalidrawElement[] {
  console.log(`Restoring images to ${elements.length} elements, ${Object.keys(imageData).length} images available`);

  return elements.map(element => {
    if (element.type === 'image' && 'fileId' in element && element.fileId) {
      const imageElement = element as any;
      const imageId = imageElement.fileId;

      // Check if we have the image data for this element
      if (imageData[imageId]) {
        console.log(`Restoring image ${imageId} to element`);
        return {
          ...element,
          dataURL: imageData[imageId], // Restore original base64 data
        };
      } else {
        console.log(`No image data found for ${imageId}, keeping reference`);
      }
    }
    return element;
  });
}

/**
 * Clean up images for a deleted note
 */
export async function cleanupImages(noteId: string): Promise<void> {
  try {
    await invoke('cleanup_excalidraw_images', { noteId });
  } catch (error) {
    console.error('Failed to cleanup images:', error);
  }
}
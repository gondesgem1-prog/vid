/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from '@google/genai';

const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const generateButton = document.getElementById('generate-button') as HTMLButtonElement;
const statusSection = document.getElementById('status-section') as HTMLElement;
const statusMessage = document.getElementById('status-message') as HTMLElement;
const resultsSection = document.getElementById('results-section') as HTMLElement;

// Initialize the Gemini AI model
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

generateButton.addEventListener('click', generateVideos);

async function generateVideos() {
  const userPrompt = promptInput.value;
  if (!userPrompt) {
    alert('Please enter a video description.');
    return;
  }

  setLoading(true, 'Warming up the creative engine...');
  resultsSection.innerHTML = '';

  try {
    // 1. Enhance the prompt
    statusMessage.textContent = 'Enhancing your prompt for amazing results...';
    const enhancedPrompt = await enhancePrompt(userPrompt);

    const totalVideosToGenerate = 5;
    const maxVideosPerRequest = 2; // Based on API error message
    const allVideoUris: string[] = [];
    let videosGenerated = 0;
    let batchNumber = 1;

    // Loop to generate videos in batches
    while (videosGenerated < totalVideosToGenerate) {
        const videosInThisBatch = Math.min(maxVideosPerRequest, totalVideosToGenerate - videosGenerated);
        
        statusMessage.textContent = `Generating Batch ${batchNumber} of ${Math.ceil(totalVideosToGenerate/maxVideosPerRequest)}... This may take a few minutes.`;

        // 2. Generate a batch of videos
        let operation = await ai.models.generateVideos({
            model: 'veo-2.0-generate-001',
            prompt: enhancedPrompt,
            config: {
                numberOfVideos: videosInThisBatch,
            },
        });

        // 3. Poll for results for this batch
        const loadingMessages = [
          "Mixing colors and shaping scenes...",
          "The digital director is calling 'Action!'...",
          "Rendering pixels into motion...",
          "Almost there, adding the final sparkle...",
        ];
        let messageIndex = 0;
        
        let pollRetries = 0;
        const maxPollRetries = 5;
        let pollDelay = 20000; // Increased base delay to 20 seconds

        while (!operation.done) {
          // Display a user-friendly message that cycles through the loading messages.
          const userFacingMessage = `Generating Batch ${batchNumber}... (${loadingMessages[messageIndex % loadingMessages.length]})`;
          // If the status message isn't already showing a retry warning, update it.
          if (!statusMessage.textContent?.includes('Rate limit')) {
              statusMessage.textContent = userFacingMessage;
          }
          messageIndex++;
          
          await new Promise(resolve => setTimeout(resolve, pollDelay));
          
          try {
            operation = await ai.operations.getVideosOperation({ operation: operation });
            // On successful poll, reset retry counters and delay
            pollRetries = 0; 
            pollDelay = 20000; 
          } catch (error) {
            const isRateLimitError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED'));
            
            if (isRateLimitError && pollRetries < maxPollRetries) {
                pollRetries++;
                // Exponential backoff, but cap at 1 minute to avoid excessive waits
                pollDelay = Math.min(60000, pollDelay * 2); 
                statusMessage.textContent = `Rate limit reached. Waiting ${pollDelay / 1000}s before retrying...`;
                // The loop will wait for the new `pollDelay` on the next iteration.
                // We `continue` to ensure we don't proceed with a failed operation object.
                continue; 
            } else {
                // If it's not a rate limit error, or we've exhausted retries, fail gracefully.
                throw new Error(`Polling failed after ${pollRetries} retries: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }

        if (!operation.response?.generatedVideos || operation.response.generatedVideos.length === 0) {
            throw new Error(`Video generation batch ${batchNumber} failed to produce any videos.`);
        }
        
        const batchVideoUris = operation.response.generatedVideos.map(v => v.video?.uri).filter(Boolean) as string[];
        allVideoUris.push(...batchVideoUris);
        videosGenerated += batchVideoUris.length;
        batchNumber++;
    }


    statusMessage.textContent = 'Finalizing all videos and preparing for download...';

    // 4. Display and download all videos
    await Promise.all(allVideoUris.map((uri, index) => 
        displayAndDownloadVideo(uri, index + 1)
    ));

  } catch (error) {
    console.error('Video generation failed:', error);
    statusMessage.textContent = `An error occurred: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    setLoading(false);
  }
}

async function enhancePrompt(originalPrompt: string): Promise<string> {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Enhance this user prompt for a video generation model. Make it highly detailed and descriptive. Crucially, specify that the video must have a consistent main character and be in a portrait (9:16) aspect ratio, suitable for Instagram promotions. Return only the enhanced prompt. User prompt: "${originalPrompt}"`,
    });
    return response.text;
}

async function displayAndDownloadVideo(uri: string, index: number) {
  try {
    const response = await fetch(`${uri}&key=${process.env.API_KEY}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch video ${index}: ${response.statusText}`);
    }
    const videoBlob = await response.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    // Display video
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.muted = true; // Autoplay requires muted
    videoElement.loop = true;
    
    const videoLabel = document.createElement('p');
    videoLabel.textContent = `Video ${index}`;

    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(videoLabel);
    resultsSection.appendChild(videoContainer);

    // Trigger download
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `generated_video_${index}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
  } catch (error) {
    console.error(`Failed to process video ${index}:`, error);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'video-container';
    errorDiv.textContent = `Could not load video ${index}.`;
    resultsSection.appendChild(errorDiv);
  }
}

function setLoading(isLoading: boolean, message = '') {
  if (isLoading) {
    generateButton.disabled = true;
    statusSection.style.display = 'flex';
    statusMessage.textContent = message;
  } else {
    generateButton.disabled = false;
    statusSection.style.display = 'none';
  }
}
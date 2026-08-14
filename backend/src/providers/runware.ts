import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EditRequest, EditResult } from './index';

const RUNWARE_API_URL = 'https://api.runware.ai/v1';

export async function editWithRunware(request: EditRequest): Promise<EditResult> {
  const apiKey = process.env.RUNWARE_API_KEY;
  if (!apiKey) throw new Error('RUNWARE_API_KEY not configured');

  const model = request.model || 'runware:106@1'; // FLUX Kontext Dev
  const imageUrl = request.imageUrl;
  const imageBase64 = request.imageBase64;

  if (!imageUrl && !imageBase64) {
    throw new Error('imageUrl or imageBase64 required for Runware');
  }

  // Build the task payload
  const tasks: any[] = [];

  // If we have base64, upload it first
  let inputImageUUID: string | null = null;

  if (imageBase64) {
    const uploadUUID = uuidv4();
    tasks.push({
      taskType: 'imageUpload',
      taskUUID: uploadUUID,
      image: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
    });
    inputImageUUID = uploadUUID;
  }

  // If we have a relative/internal URL, fetch and upload as base64
  if (imageUrl && (imageUrl.startsWith('/') || imageUrl.startsWith('http://localhost'))) {
    const internalUrl = imageUrl.startsWith('/')
      ? `http://localhost:${process.env.PORT || 3778}${imageUrl}`
      : imageUrl;
    try {
      const res = await axios.get(internalUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const base64 = Buffer.from(res.data).toString('base64');
      const uploadUUID = uuidv4();
      tasks.push({
        taskType: 'imageUpload',
        taskUUID: uploadUUID,
        image: base64,
      });
      inputImageUUID = uploadUUID;
    } catch (err: any) {
      throw new Error(`Failed to fetch internal image for Runware: ${err.message}`);
    }
  }

  const inferenceUUID = uuidv4();

  const inferenceTask: any = {
    taskType: 'imageInference',
    taskUUID: inferenceUUID,
    model,
    positivePrompt: request.prompt,
    width: 1024,
    height: 1024,
    numberResults: 1,
    outputFormat: 'JPEG',
    outputQuality: 95,
  };

  if (!model.includes('seedream') && !model.includes('wan') && !model.includes('grok')) {
    inferenceTask.steps = request.steps || 30;
    inferenceTask.strength = request.strength || 0.75;
    if (request.negativePrompt) {
      inferenceTask.negativePrompt = request.negativePrompt;
    }
  }

  // Set input image
  if (inputImageUUID) {
    inferenceTask.inputImage = `@${inputImageUUID}`;
  } else if (imageUrl && !imageUrl.startsWith('/') && !imageUrl.startsWith('http://localhost')) {
    // External URL — pass directly
    inferenceTask.inputImage = imageUrl;
  }

  tasks.push(inferenceTask);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    console.log(`[Runware] Sending ${tasks.length} tasks, model: ${model}`);
    const response = await axios.post(
      RUNWARE_API_URL,
      tasks,
      { headers, timeout: 120000 }
    );

    const results = response.data;

    // Handle Runware's data wrapper
    const resultArray = Array.isArray(results) ? results : results?.data || [];
    const inferenceResult = resultArray.find((r: any) => r.taskUUID === inferenceUUID || r.taskType === 'imageInference');

    if (!inferenceResult) {
      throw new Error('No inference result from Runware. Response: ' + JSON.stringify(results).substring(0, 300));
    }

    if (inferenceResult.error) {
      throw new Error(`Runware error: ${JSON.stringify(inferenceResult.error)}`);
    }

    const outputUrl = inferenceResult.imageURL || inferenceResult.imageUrl || inferenceResult.url;
    if (!outputUrl) {
      throw new Error('No image URL in Runware response: ' + JSON.stringify(inferenceResult).substring(0, 300));
    }

    return {
      imageUrl: outputUrl,
      provider: 'runware',
      model,
      width: inferenceResult.width,
      height: inferenceResult.height,
      seed: inferenceResult.seed,
    };
  } catch (err: any) {
    if (err.response) {
      throw new Error(`Runware API error ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 300)}`);
    }
    throw new Error(`Runware edit failed: ${err.message}`);
  }
}

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const imageService = {
  uploadImage: async (fileBuffer: Buffer, folder: string, publicId?: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          format: 'webp',
          quality: 'auto',
          ...(publicId ? { public_id: publicId, overwrite: true, invalidate: true } : {}),
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Cloudinary no retornó un resultado válido.'));
          resolve(result.secure_url);
        }
      );
      
      uploadStream.end(fileBuffer);
    });
  }
};

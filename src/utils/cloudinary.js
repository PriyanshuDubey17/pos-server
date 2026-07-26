const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Delete an image from Cloudinary by its public ID.
 * @param {string} publicId - The Cloudinary public ID of the image
 */
const deleteImageFromCloudinary = async (publicId) => {
  return deleteCloudinaryAsset(publicId, "image");
};

/**
 * Delete an image or video asset from Cloudinary.
 * @param {string} publicId
 * @param {"image"|"video"} resourceType
 */
const deleteCloudinaryAsset = async (publicId, resourceType = "image") => {
  if (!publicId) return;
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    console.log(`Cloudinary ${resourceType} deleted: ${publicId}`, result);
    return result;
  } catch (error) {
    console.error(`Error deleting Cloudinary ${resourceType} ${publicId}:`, error);
  }
};

module.exports = {
  cloudinary,
  deleteImageFromCloudinary,
  deleteCloudinaryAsset,
};

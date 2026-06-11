const fs=require('fs');
const path=require('path');
const sharp=require('sharp');

const imagesDirectory=path.join(__dirname,'..','burger-bar-diana','images');

async function optimizeDirectory(directory){
  const entries=fs.readdirSync(directory,{withFileTypes:true});

  for(const entry of entries){
    const inputPath=path.join(directory,entry.name);
    if(entry.isDirectory()){
      await optimizeDirectory(inputPath);
      continue;
    }
    if(path.extname(entry.name).toLowerCase()!=='.png') continue;

    const outputPath=inputPath.replace(/\.png$/i,'.webp');
    await sharp(inputPath)
      .webp({quality:82,effort:6})
      .toFile(outputPath);
    console.log(`${path.relative(imagesDirectory,inputPath)} -> ${path.relative(imagesDirectory,outputPath)}`);
  }
}

optimizeDirectory(imagesDirectory).catch(error=>{
  console.error(error);
  process.exitCode=1;
});

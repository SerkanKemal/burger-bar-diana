const path=require('path');
const express=require('express');
require('dotenv').config();

const app=express();
const port=process.env.PORT||3000;
const publicDirectory=path.join(__dirname,'burger-bar-diana');

app.disable('x-powered-by');
app.use(express.static(publicDirectory));

app.get('/api/google-reviews',async(req,res)=>{
  const apiKey=process.env.GOOGLE_PLACES_API_KEY;
  const placeId=process.env.GOOGLE_PLACE_ID;

  if(!apiKey||!placeId){
    return res.status(503).json({
      error:'Google Places API is not configured.'
    });
  }

  try{
    const response=await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=bg`,
      {
        headers:{
          'X-Goog-Api-Key':apiKey,
          'X-Goog-FieldMask':'rating,userRatingCount,reviews,googleMapsUri'
        }
      }
    );

    if(!response.ok){
      const details=await response.text();
      console.error('Google Places API error:',response.status,details);
      return res.status(502).json({error:'Google reviews are temporarily unavailable.'});
    }

    const place=await response.json();
    const reviews=(place.reviews||[]).map(review=>({
      author:review.authorAttribution?.displayName||'Google потребител',
      authorUri:review.authorAttribution?.uri||'',
      photoUri:review.authorAttribution?.photoUri||'',
      rating:review.rating||0,
      text:review.text?.text||review.originalText?.text||'',
      relativeTime:review.relativePublishTimeDescription||'',
      publishTime:review.publishTime||''
    }));

    res.set('Cache-Control','no-store');
    return res.json({
      rating:place.rating||0,
      userRatingCount:place.userRatingCount||0,
      googleMapsUri:place.googleMapsUri||'',
      reviews,
      updatedAt:new Date().toISOString()
    });
  }catch(error){
    console.error('Could not load Google reviews:',error);
    return res.status(502).json({error:'Google reviews are temporarily unavailable.'});
  }
});

app.get('*path',(req,res)=>{
  res.sendFile(path.join(publicDirectory,'index.html'));
});

app.listen(port,()=>{
  console.log(`Burger Bar Diana is running at http://localhost:${port}`);
});

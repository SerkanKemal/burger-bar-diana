const timeZone='Europe/Sofia';
const orderStartMinutes=11*60+30;
const orderEndMinutes=22*60+30;
const dayNames={Mon:'понеделник',Tue:'вторник',Wed:'сряда',Thu:'четвъртък',Fri:'петък',Sat:'събота',Sun:'неделя'};
const nextDay={Mon:'Tue',Tue:'Wed',Wed:'Thu',Thu:'Fri',Fri:'Sat',Sat:'Sun',Sun:'Tue'};

function localParts(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone,
    weekday:'short',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(now);
  const value=type=>parts.find(part=>part.type===type)?.value;
  return {day:value('weekday'),minutes:Number(value('hour'))*60+Number(value('minute'))};
}

function formatMinutes(minutes){
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}

function nextOpening(day,minutes){
  if(day!=='Mon'&&minutes<orderStartMinutes) return `днес в ${formatMinutes(orderStartMinutes)}`;
  const next=nextDay[day];
  return `${dayNames[next]} в ${formatMinutes(orderStartMinutes)}`;
}

function getOrderHoursStatus(now=new Date()){
  const {day,minutes}=localParts(now);
  const open=day!=='Mon'&&minutes>=orderStartMinutes&&minutes<=orderEndMinutes;
  return {
    open,
    timeZone,
    orderStart:formatMinutes(orderStartMinutes),
    orderEnd:formatMinutes(orderEndMinutes),
    nextOpening:open?null:nextOpening(day,minutes),
    message:open
      ?`Приемаме онлайн поръчки до ${formatMinutes(orderEndMinutes)} ч.`
      :`В момента не приемаме онлайн поръчки. Следващо отваряне: ${nextOpening(day,minutes)} ч.`
  };
}

function isValidRequestedTime(value){
  if(!value) return true;
  const match=String(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if(!match) return false;
  const minutes=Number(match[1])*60+Number(match[2]);
  return minutes>=orderStartMinutes&&minutes<=orderEndMinutes;
}

module.exports={getOrderHoursStatus,isValidRequestedTime};

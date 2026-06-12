const timeZone='Europe/Sofia';

function zonedParts(date){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    weekday:'short'
  }).formatToParts(date);
  const value=type=>parts.find(part=>part.type===type)?.value;
  return {
    year:Number(value('year')),
    month:Number(value('month')),
    day:Number(value('day')),
    weekday:value('weekday')
  };
}

function offsetAt(date){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  const value=type=>Number(parts.find(part=>part.type===type)?.value);
  const represented=Date.UTC(value('year'),value('month')-1,value('day'),value('hour'),value('minute'),value('second'));
  return represented-date.getTime();
}

function localMidnightUtc(year,month,day){
  const guess=Date.UTC(year,month-1,day);
  let result=new Date(guess-offsetAt(new Date(guess)));
  result=new Date(guess-offsetAt(result));
  return result;
}

function addCalendarDays(parts,days){
  const date=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days));
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}

function rangeFor(filter,now=new Date()){
  const today=zonedParts(now);
  const weekdayIndex={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6}[today.weekday];
  let start;
  let end;
  if(filter==='today'){
    start=today;
    end=addCalendarDays(today,1);
  }else if(filter==='this-week'){
    start=addCalendarDays(today,-weekdayIndex);
    end=addCalendarDays(start,7);
  }else if(filter==='previous-week'){
    end=addCalendarDays(today,-weekdayIndex);
    start=addCalendarDays(end,-7);
  }else{
    return null;
  }
  return {
    start:localMidnightUtc(start.year,start.month,start.day),
    end:localMidnightUtc(end.year,end.month,end.day)
  };
}

function buildOrderFilter(filter,now=new Date()){
  const allowed=new Set(['active','today','this-week','previous-week','completed','all']);
  const selected=allowed.has(filter)?filter:'active';
  const conditions=[];
  const values=[];
  if(selected==='active') conditions.push("status NOT IN ('completed','cancelled')");
  if(selected==='completed') conditions.push("status IN ('completed','cancelled')");
  const range=rangeFor(selected,now);
  if(range){
    conditions.push('created_at>=? AND created_at<?');
    values.push(range.start,range.end);
  }
  return {selected,where:conditions.length?`WHERE ${conditions.join(' AND ')}`:'',values};
}

module.exports={buildOrderFilter,rangeFor};

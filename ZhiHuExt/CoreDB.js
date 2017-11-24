"use strict"
//import { Dexie } from "./dexie.min.js"


/**
 * @param {string} prop
 */
async function toNameMap(prop)
{
    const result = {};
    await this.each(obj => result[obj[prop]] = obj);
    return result;
}
async function toPropMap(keyProp, valProp)
{
    const result = {};
    await this.each(obj => result[obj[keyProp]] = obj[valProp]);
    return result;
}
if (typeof Dexie !== "undefined")
{
    Dexie.addons.push(x => x.Collection.prototype.toNameMap = toNameMap);
    Dexie.addons.push(x => x.Collection.prototype.toPropMap = toPropMap);
}

var BAN_UID = new Set();
var SPAM_UID = new Set();

class ZhiHuDB
{
    static hook(thedb)
    {
        thedb.spams.hook("creating", (primKey, obj, trans) =>
        {
            if (obj.type === "member")
                SPAM_UID.add(obj.id);
        });
        thedb.users.hook("creating", (primKey, obj, trans) =>
        {
            if (obj.status === null)
                obj.status = "";
            else if (obj.status === "ban" || obj.status === "sban")
                BAN_UID.add(obj.id);
        });
        thedb.users.hook("updating", (mods, primKey, obj, trans) =>
        {
            const keys = Object.keys(mods);
            if (keys.length === 0) return;
            const ret = {};
            {
                if (mods.status === "ban" || mods.status === "sban")
                    BAN_UID.add(obj.id);
                else if (mods.status === "")
                    BAN_UID.delete(obj.id);
            }
            for (let idx = 0; idx < keys.length; idx++)
            {
                const key = keys[idx], val = mods[key];
                if ((val === -1 || val === null))
                    if (obj.hasOwnProperty(key))
                        ret[key] = obj[key];//skip unset values
            }
            //console.log("compare", mods, ret);
            return ret;
        });
        thedb.zans.hook("updating", (mods, primKey, obj, trans) =>
        {
            if (mods.time === -1)
                return { time: obj.time };//skip empty time
            return;
        });
        thedb.zanarts.hook("updating", (mods, primKey, obj, trans) =>
        {
            if (mods.time === -1)
                return { time: obj.time };//skip empty time
            return;
        });
        thedb.articles.hook("updating", (mods, primKey, obj, trans) =>
        {
            const keys = Object.keys(mods);
            if (keys.length === 0) return;
            const ret = {};
            for (let idx = 0; idx < keys.length; idx++)
            {
                const key = keys[idx], val = mods[key];
                if ((val === -1 || val === null))
                    ret[key] = obj[key];//skip unset values
            }
            return ret;
        });
        thedb.answers.hook("updating", (mods, primKey, obj, trans) =>
        {
            const keys = Object.keys(mods);
            if (keys.length === 0) return;
            const ret = {};
            for (let idx = 0; idx < keys.length; idx++)
            {
                const key = keys[idx], val = mods[key];
                if ((val === -1 || val === null))
                    ret[key] = obj[key];//skip unset values
            }
            return ret;
        });
        thedb.questions.hook("creating", (primKey, obj, trans) =>
        {
            if (obj.topics === null)
                obj.topics = [];
        });
        thedb.questions.hook("updating", (mods, primKey, obj, trans) =>
        {
            const hasModTopic = Object.keys(mods).find(key => key.startsWith("topics."));
            const ret = {};
            if (mods.timeC === -1)
                ret.timeC = obj.timeC;
            if (!mods.topics && !hasModTopic)
                ret.topics = obj.topics;
            return ret;
        });
    }

    /**
     * @param {string} dbname
     * @param {{[x:string]: string}[]} def
     * @param {function(any):void[]} upgrader
     * @param {function():void} onDone
     */
    constructor(dbname, def, upgrader, onDone)
    {
        /**@type {{[x:string]: {}}}*/
        this.db = new Dexie(dbname);
        for (let v = 0; v < def.length; ++v)
        {
            const st = this.db.version(v + 1).stores(def[v])
            if (upgrader[v])
                st.upgrade(upgrader[v]);
        }
        ZhiHuDB.hook(this.db);
        this.db.open()
            .then(onDone)
            .catch(e => console.error("cannot open db", e));
        for (const table in def[def.length - 1])
            this[table] = this.db[table];
    }

    /**
     * @param {string} target
     * @param {object | object[]} data
     * @param {function(number):void} [notify]
     */
    insert(target, data, notify)
    {
        if (target === "batch")
        {
            let sum = 0;
            Object.entries(data).forEach(([key, val]) => sum += this.insert(key, val));
            if (notify)
                notify(sum);
            return sum;
        }
        const table = this.db[target];
        if (!table)
        {
            console.warn("unknown table", target, data);
            return 0;
        }
        let pms;
        let count = 0;
        if (!(data instanceof Array))
        {
            count = 1;
            pms = table.put(data);
        }
        else if (data.length > 0)
        {
            data = StandardDB.innerMerge(target, data);
            count = data.length;
            pms = table.bulkPut(data);
        }
        else
            return 0;
        pms.catch(error => console.warn("[insert] failed!", error, target, data));
        if (notify)
            notify(count);
        return count;
    }
    /**
     * @param {string} target
     * @param {{obj: object | object[], key: string, updator: object}} data
     */
    update(target, data)
    {
        const table = this.db[target];
        if (!table)
            return false;
        console.log("updateDB", target, data);
        let matchs;
        if (data.obj instanceof Array)
            matchs = table.where(data.key).anyOf(data.obj);
        else
            matchs = table.where(data.key).equals(data.obj);
        matchs.modify(match => Object.assign(match, data.updator))
            .catch(error => console.warn("[update] failed!", error, target, data));
        return true;
    }
    async count()
    {
        const ret = { ban: BAN_UID.size };
        /**@type {Promise<void>[]}*/
        const tabpmss = this.db.tables.map(async table =>
        {
            ret[table.name] = await table.count();
            console.log("table counted", table.name);
        });
        await Promise.all(tabpmss);
        return ret;
    }
    export()
    {
        const pms = $.Deferred();
        this.db.transaction("r", this.db.tables, () =>
        {
            const ret = {};
            const tabpmss = this.db.tables.map(async table =>
            {
                ret[table.name] = await table.toArray();
                console.log("export table [" + table.name + "] success");
            });
            Promise.all(tabpmss)
                .then(() => pms.resolve(ret))
                .catch(e => pms.reject(e));
        });
        return pms;
    }
    /**
     * @param {string} table
     * @param {number} from
     * @param {number} count
     * @returns {Promise<string> | Promise<string[]>}
     */
    async part(table, from, count)
    {
        if (table == null)
            return this.db.tables.mapToProp("name");
        return JSON.stringify(await this.db[table].offset(from).limit(count).toArray());
    }



    /**
     * @param {string} table
     * @param {[] | Promise<any>} id
     * @param {string} prop
     * @returns {{[x:any]: any}}
     */
    async getPropMapOfIds(table, id, prop)
    {
        const ids = await toPureArray(id);
        const retMap = await this.db[table].where("id").anyOf(ids).toPropMap("id", prop);
        return retMap;
    }
    /**
     * @param {string} table
     * @param {any} id
     * @param {string} name
     * @param {...string} except
     * @returns {{[id:string]: object}}
     */
    async getDetailMapOfIds(table, id, name, except)
    {
        const ids = await toPureArray(id);
        const ret = await this.db[table].where("id").anyOf(ids).toArray();
        const retMap = {};
        for (let i = 0; i < ret.length; ++i)
        {
            const obj = ret[i];
            for (const ex of except)
                delete obj[ex];
            retMap[obj[name]] = obj;
        }
        return retMap;
    }
    /**
     * @param {number | number[] | BagArray | Promise<Any>} id
     * @param {"answer" | "article"} target
     * @returns {Promise<BagArray>}
     */
    async getVoters(id, target)
    {
        const ids = await toPureArray(id);
        console.log(`here [${ids.length}] ${target} ids`);
        const table = (target === "answer" ? this.db.zans : this.db.zanarts);
        /**@type {Zan[]}*/
        const zans = await table.where("to").anyOf(ids).toArray();
        console.log("get [" + zans.length + "] zans");
        const zanBag = new SimpleBag(zans.mapToProp("from"));
        return zanBag.toArray("desc");
    }
    /**
     * @param {number | number[] | BagArray | Promise<Any>} uid
     * @param {"desc" | "asc"} [order]
     * @param {number} [minrate]
     * @returns {Promise<BagArray>}
     */
    async getVotersByVoter(uid, order, minrate)
    {
        const uids = await toPureArray(uid);
        console.log("here [" + uids.length + "] initial voters");
        const pmss = [this.db.zans.where("from").anyOf(uid).toArray(), this.db.zanarts.where("from").anyOf(uid).toArray()];
        const [anszan1, artzan1] = await Promise.all(pmss);
        console.log(`here [${anszan1.length}] answer zans, [${artzan1.length}] article zans`);

        const ansid = new Set(anszan1.mapToProp("to")).toArray(), artid = new Set(artzan1.mapToProp("to")).toArray();
        const pmss2 = [this.db.zans.where("to").anyOf(ansid).toArray(), this.db.zanarts.where("to").anyOf(artid).toArray()];
        const [anszan2, artzan2] = await Promise.all(pmss2);
        console.log(`here [${anszan2.length}] answer voters, [${artzan2.length}] article voters`);

        const bag = new SimpleBag(anszan2.mapToProp("from")).adds(artzan2.mapToProp("from"));
        if (!minrate)
            return bag.toArray(order);
        const mincount = minrate < 1 ? minrate * (anszan1.length + artzan1.length) : minrate;
        return bag.above(mincount).toArray(order);
    }
    /**
     * @param {number | number[] | BagArray | Promise<Any>} uid
     * @param {"desc" | "asc"} [order]
     * @param {number} [mincount]
     * @returns {Promise<BagArray>}
     */
    async getVotersByAuthor(uid, order, mincount)
    {
        const uids = await toPureArray(uid);
        console.log("here [" + uids.length + "] authors");
        const pmss = [this.db.answers.where("author").anyOf(uids).primaryKeys(), this.db.articles.where("author").anyOf(uids).primaryKeys()];
        const [ansid, artid] = await Promise.all(pmss);
        console.log(`here [${ansid.length}] answer ids, [${artid.length}] article ids`);

        const pmss2 = [this.db.zans.where("to").anyOf(ansid).toArray(), this.db.zanarts.where("to").anyOf(artid).toArray()];
        const [anszan, artzan] = await Promise.all(pmss2);
        console.log(`here [${anszan.length}] answer voters, [${artzan.length}] article voters`);
        const bag = new SimpleBag(anszan.mapToProp("from")).adds(artzan.mapToProp("from"));
        if (mincount)
            return bag.above(mincount).toArray(order);
        else
            return bag.toArray(order);
    }
    /**
     * @param {string | string[] | BagArray | Promise<Any>} uid
     * @param {"answer" | "article"} target
     * @param {"desc" | "asc"} [order]
     * @returns {Promise<BagArray>}
     */
    async getIdByVoter(uid, target, order)
    {
        const uids = await toPureArray(uid);
        console.log("here [" + uids.length + "] uids");
        const table = (target === "answer" ? this.db.zans : this.db.zanarts);
        const zans = await table.where("from").anyOf(uids).toArray();
        console.log(`here [${zans.length}] ${target} zans`);
        const ids = new SimpleBag(zans.mapToProp("to"));
        return ids.toArray(order);
    }
    /**
     * @param {string | string[] | BagArray | Promise<Any>} uid
     * @param {"answer" | "article"} target
     * @returns {Promise<number[]>}
     */
    async getIdByAuthor(uid, target)
    {
        const uids = await toPureArray(uid);
        console.log("here [" + uids.length + "] uids");
        const table = (target === "answer" ? this.db.answers : this.db.articles);
        const ids = await table.where("author").anyOf(uids).primaryKeys();
        console.log(`here [${ids.length}] ${target} ids`);
        return ids;
    }
    async getAnsIdByVoter(uid, order)
    {
        const uids = await toPureArray(uid);
        console.log("here [" + uids.length + "] uids");
        const zans = await this.db.zans.where("from").anyOf(uids).toArray();
        console.log("get [" + zans.length + "] zans");
        const ansids = new SimpleBag(zans.mapToProp("to")).toArray(order);
        console.log("reduce to [" + ansids.length + "] answers");
        return ansids;
    }
    async getAnswerByQuestion(qsts)
    {
        const qids = await toPureArray(qsts);
        console.log("here [" + qids.length + "] qids");
        const answers = await this.db.answers.where("question").anyOf(qids).toArray();
        console.log("get [" + answers.length + "] questions");
        return answers;
    }
    async getAnsIdByQuestion(qsts)
    {
        const qids = await toPureArray(qsts);
        console.log("here [" + qids.length + "] qids");
        const ansids = await this.db.answers.where("question").anyOf(qids).primaryKeys();
        console.log("get [" + ansids.length + "] questions");
        return ansids;
    }
    async getQuestIdByAnswer(anss)
    {
        const ansMap = await getPropMapOfIds("answers", anss, "question");
        console.log("get [" + Object.keys(ansMap).length + "] answers");
        const ansarray = await toSimpleBagArray(anss);
        const questBag = new SimpleBag();
        ansarray.forEach(ans => questBag.addMany(ansMap[ans.key], ans.count));
        const qsts = questBag.toArray("desc");
        console.log("reduce to [" + qsts.length + "] questions");
        return qsts;
    }

}




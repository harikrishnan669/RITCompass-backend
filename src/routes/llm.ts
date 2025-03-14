    import {Router} from "express";
import {ChatOpenAI} from "@langchain/openai";
import {HumanMessage, SystemMessage} from "@langchain/core/messages";
import initialData from "../data/initialData";
import {DataCategory} from "../data/data.type";
import HTTP_status from "../lib/HTTP_status";
import jwt from "jsonwebtoken";

const llmRouter = Router();


const categorizePrompt = `
You are an intelligent assistant that helps categorize user queries into predefined topics. 

You have the following categories and their associated keywords:

${Object.keys(initialData)
    .map(category => `- ${category}: [${initialData[category].keywords.join(", ")}]`)
    .join("\n")}

Your task is to analyze the user query and determine which category (or multiple categories) it belongs to. 
If the query fits multiple categories, return all relevant ones.

Return the category name(s) as a JSON array, for example:

["scholarship", "gym_membership"]

If the query does not match any category, return an empty array: 

[]

Now, analyze the following user query and provide the appropriate categories.
`;


function formatDataPoint(data: DataCategory) {
    let str = `# ${data.name}
${data.short_desc}
`;
    for (let item of data.items) {
        str += `\n## ${item.title}
${item.description}
`;
        if (item.steps) {
            str += `\n### Steps\n`
            let i = 0;
            for (let step of item.steps) {
                str += `.${i} **${step.title}**
    ${step.description}
    - Responsible Authority: ${step.responsible_authority}
    - Expected time: ${step.expected_time || "N/A"}
`;
                ++i;
            }
        }

        if (item.docs_needed) {
            str += `\n### Documents Needed\n`
            let i = 0;
            for (let doc of item.docs_needed) {
                str += `.${i} **${doc.type}**
    ${doc.template}
    - Fields: ${doc.fields.join(", ")}`;
                ++i;
            }
        }
    }

    return str;
}

const strictModel = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0
});

const freeModel = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 1
});

llmRouter.post('/ask', async (req, res) => {
    const {msg, chat_id} = req.body;

    if (!msg || !chat_id) {
        return res.status(HTTP_status.BAD_REQUEST).json({
            success: false,
            message: !chat_id && !msg ? 'msg and chat_id is required' : !msg ? 'msg is required' : 'chat_id is required'
        })
    }

    let currModel = strictModel;

    try {
        const authHeader = req.headers['authorization'];
        let decoded;
        if (authHeader)
                decoded = jwt.decode(authHeader.split(' ')[1]!);

        const messages = [
            new SystemMessage(categorizePrompt),
            new HumanMessage(msg),
        ];

        const result = await strictModel.invoke(messages);

        const categories = JSON.parse(result.content as string);

        const fromCatStr = categories.map((category: string) => formatDataPoint(initialData[category]));
        
        console.log("CATS:", categories)

        if(categories.length === 0) {
            console.info("Used a free model; as categorizer is empty");
            currModel = freeModel;
        }

        const finalPrompt = `IMPORTANT: Only give back json. No need for markdown or any other things. Only give json. You are an intelligent assistant called RITCompass of RIT college, you provides clear, easy-to-follow steps to help you navigate college life at RIT, you acts as a query engine that converts given data into a structured response in json. You sit at the backend and from the frontend a prompt is passed (to which a context is added). If any unrelated query is asked return a message (with type = message) in the data returned. You should return an array of data in timeline or message in json.
[{
    "type": "timeline" | "message",
    "timeline": [
        {
        "title": "<Step Title>",
        "description": "<Step Description>",
        "responsible_authority": "<Who handles this>",
        "expected_time": "<Time estimate (if available)>",
        "related_links": "<related links>"
        }
    ],
    "message": "<some message>", // Available only if no timeline is present
    remarks: "<Any additional remarks>",
}]
The following is a data point about a specific process(s) (each process is in its own block):
${fromCatStr.map((i: any) => "```md\n" + i + "\n```").join("\n---\n")}

Extract the key steps involved in the process and convert them into a **timeline** format (json) for each process add that data to any array and return this;`;


        const finalMsg = [
            new SystemMessage(finalPrompt),
            new HumanMessage(msg),
        ];

        const primaryResult = await currModel.invoke(finalMsg);


        console.log(decoded);

        // const chat = new History({
        //     chat_id,
        //     user_id: "1234",
        //     user_msg: msg,
        //     ai_msg: primaryResult.content as string
        // })

        return res.json({
            status: "categorized",
            categories: JSON.parse(result.content as string),
            data: JSON.parse(primaryResult.content as string)
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({
            error: e
        });
    }
});


export default llmRouter;
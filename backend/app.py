from flask import Flask, request, jsonify
from dotenv import load_dotenv
from flask_cors import CORS
import os
import openai
import requests
from tavily import TavilyClient
import json

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)

CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize API clients
openai.api_key = os.getenv("OPENAI_API_KEY")
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

@app.route('/session', methods=['GET'])
def create_session():
    """Create an ephemeral token for the WebRTC connection"""
    try:
        response = requests.post(
            "https://api.openai.com/v1/realtime/sessions",
            headers={
                "Authorization": f"Bearer {os.getenv('OPENAI_API_KEY')}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-realtime-preview-2024-12-17",
                "voice": "verse",  
            }
        )
        print(response)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/search', methods=['POST'])
def search():
    """Perform a search using Tavily API"""
    data = request.json
    query = data.get('query', '')
    
    try:
        # First try to search about Sena services
        search_result = tavily_client.search(
            query=f"{query} site:sena.services",
            search_depth="advanced",
            include_domains=["sena.services"]
        )
        
        # If no good results, search for cricket results
        if not search_result.get('results') or len(search_result.get('results', [])) == 0:
            search_result = tavily_client.search(
                query=f"cricket results March 09, 2025",
                search_depth="advanced"
            )
        print(search_result)
        return jsonify(search_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/')
def index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    app.run(debug=True)